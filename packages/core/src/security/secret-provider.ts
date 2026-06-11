// src/security/secret-provider.ts
// Phase 8 — SecretProvider (Requirement 9).
//
// A single `SecretProvider` interface with first-class adapters for GitHub
// Secrets, AWS Secrets Manager, Azure Key Vault, and GCP Secret Manager (R9.2),
// plus a redaction registry that keeps retrieved secret values out of log output
// (R9.4) and a required-secret startup gate that fails fast emitting only the
// missing secret's NAME, never its value (R9.5).
//
// This module *builds on* the existing infrastructure rather than replacing it
// (R9.1):
//   - The AWS/Azure/GCP adapters delegate network retrieval to the already
//     hardened, SDK-free providers in `../cloud/secret-providers.js`, wrapping
//     them with refresh-on-read semantics and automatic redaction registration.
//   - The startup gate mirrors the required-variable failure behavior of
//     `vault.loadConfig` (emit the name, never the value, exit non-zero).
//
// Refresh-on-read (R9.6): by default every adapter re-reads its upstream on each
// `get()` (TTL = 0), so a value rotated in the external store is observed on the
// next request without a process restart. A positive `ttlMs` may be supplied to
// trade a short staleness window for fewer upstream calls; even then a rotated
// value appears once the (short) TTL elapses, never requiring a restart.

import {
  AwsSecretsManagerProvider as CloudAwsSecretsManagerProvider,
  AzureKeyVaultProvider as CloudAzureKeyVaultProvider,
  GcpSecretManagerProvider as CloudGcpSecretManagerProvider,
  type HttpClientOptions,
  type SecretProvider as CloudSecretProvider,
} from '../cloud/secret-providers.js';

// ── SecretProvider interface ──────────────────────────────────────────────────

/**
 * The single interface implemented by every secret adapter (R9.2). Callers
 * request a secret by name and receive its current value through the configured
 * upstream store (R9.3).
 */
export interface SecretProvider {
  /** Retrieve a secret by name through the configured adapter (R9.3). */
  get(name: string): Promise<string>;
}

/**
 * A low-level retrieval seam: given a secret name, return its raw value. This is
 * the injection point used by tests to stand in for a cloud SDK/HTTP client, and
 * the seam each adapter fills with its real upstream call.
 */
export type SecretFetcher = (name: string) => Promise<string>;

// ── Redaction registry (R9.4) ─────────────────────────────────────────────────

/**
 * The set of secret values that must never appear in log output. Values are
 * registered automatically whenever an adapter or {@link requireSecrets}
 * successfully retrieves a secret, and {@link redact} masks them in any string
 * before it is written to a log sink — including startup error handlers.
 */
const REDACTION_REGISTRY = new Set<string>();

/** The token substituted in place of a registered secret value. */
export const REDACTION_PLACEHOLDER = '[REDACTED]';

/**
 * Register a secret value so it is masked by {@link redact} everywhere (R9.4).
 * Empty values are ignored (there is nothing meaningful to mask, and masking the
 * empty string would corrupt every log line).
 */
export function registerSecretForRedaction(value: string): void {
  if (typeof value === 'string' && value.length > 0) {
    REDACTION_REGISTRY.add(value);
  }
}

/**
 * Replace every occurrence of a registered secret value in `line` with
 * {@link REDACTION_PLACEHOLDER} (R9.4). Uses literal substring replacement so no
 * value is interpreted as a regular expression. Returns `line` unchanged when no
 * registered secret is present.
 */
export function redact(line: string): string {
  let out = line;
  for (const secret of REDACTION_REGISTRY) {
    if (secret.length === 0) continue;
    if (out.includes(secret)) {
      out = out.split(secret).join(REDACTION_PLACEHOLDER);
    }
  }
  return out;
}

/**
 * Clear the redaction registry. Intended for test isolation; production code has
 * no reason to forget secrets it has been asked to mask.
 */
export function clearRedactionRegistry(): void {
  REDACTION_REGISTRY.clear();
}

// ── Refresh-on-read base ──────────────────────────────────────────────────────

/** Common options for the secret adapters in this module. */
export interface SecretProviderBaseOptions {
  /**
   * Cache window in milliseconds. Defaults to `0`, meaning every `get()`
   * re-reads the upstream so a rotated value is observed on the next request
   * without a restart (R9.6). A positive value caps upstream calls at the cost
   * of a bounded staleness window.
   */
  ttlMs?: number;
  /** Injected clock for deterministic tests; defaults to {@link Date.now}. */
  now?: () => number;
}

interface CacheEntry {
  value: string;
  expiresAt: number;
}

/**
 * Base class implementing refresh-on-read caching and automatic redaction
 * registration. Subclasses implement {@link fetchSecret} with their upstream
 * retrieval; every successfully retrieved value is registered for redaction
 * before it is returned (R9.4/R9.6).
 */
abstract class RefreshOnReadProvider implements SecretProvider {
  protected readonly ttlMs: number;
  private readonly now: () => number;
  private readonly cache = new Map<string, CacheEntry>();

  protected constructor(opts: SecretProviderBaseOptions = {}) {
    this.ttlMs = opts.ttlMs ?? 0;
    this.now = opts.now ?? Date.now;
  }

  /** Retrieve the raw secret value from the upstream store. */
  protected abstract fetchSecret(name: string): Promise<string>;

  async get(name: string): Promise<string> {
    if (this.ttlMs > 0) {
      const cached = this.cache.get(name);
      if (cached && this.now() < cached.expiresAt) return cached.value;
    }

    const value = await this.fetchSecret(name);
    // Every retrieved value is masked from logs from this point on (R9.4).
    registerSecretForRedaction(value);

    if (this.ttlMs > 0) {
      this.cache.set(name, { value, expiresAt: this.now() + this.ttlMs });
    }
    return value;
  }
}

// ── GitHubSecretsProvider ─────────────────────────────────────────────────────

/** Options for {@link GitHubSecretsProvider}. */
export interface GitHubSecretsProviderOptions extends SecretProviderBaseOptions {
  /** Environment source GitHub Actions injects secrets into; defaults to `process.env`. */
  env?: NodeJS.ProcessEnv;
  /** Optional prefix applied to the secret name before the env lookup. */
  prefix?: string;
}

/**
 * Adapter for GitHub Actions Secrets. GitHub does not expose a read API for
 * repository/organization secrets; instead the Actions runner injects configured
 * secrets into the workflow environment. This adapter therefore resolves secrets
 * from the process environment (the GitHub-native surface), which is inherently
 * refresh-on-read since the environment is read on every call.
 */
export class GitHubSecretsProvider extends RefreshOnReadProvider {
  private readonly env: NodeJS.ProcessEnv;
  private readonly prefix: string;

  constructor(opts: GitHubSecretsProviderOptions = {}) {
    super(opts);
    this.env = opts.env ?? process.env;
    this.prefix = opts.prefix ?? '';
  }

  protected async fetchSecret(name: string): Promise<string> {
    const key = `${this.prefix}${name}`;
    const value = this.env[key];
    if (value === undefined || value === '') {
      throw new Error(`GitHubSecretsProvider: secret "${name}" is not present in the environment`);
    }
    return value;
  }
}

// ── AwsSecretsManagerProvider ─────────────────────────────────────────────────

/** Options for the Phase 8 {@link AwsSecretsManagerProvider}. */
export interface AwsSecretsManagerProviderOptions extends SecretProviderBaseOptions {
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** Override the service endpoint (VPC endpoint, LocalStack, or test server). */
  endpoint?: string;
  tls?: HttpClientOptions;
  /** Injected retrieval seam (e.g. a mocked SDK client) used in place of HTTP. */
  fetcher?: SecretFetcher;
}

/**
 * AWS Secrets Manager adapter. Delegates retrieval to the SDK-free cloud
 * provider (SigV4 over `node:https`) configured for refresh-on-read, or to an
 * injected {@link SecretFetcher} for testing (R9.2/R9.3/R9.6).
 */
export class AwsSecretsManagerProvider extends RefreshOnReadProvider {
  private readonly fetcher: SecretFetcher;

  constructor(opts: AwsSecretsManagerProviderOptions) {
    super(opts);
    this.fetcher = opts.fetcher ?? buildCloudFetcher(
      new CloudAwsSecretsManagerProvider({
        region: opts.region,
        accessKeyId: opts.accessKeyId,
        secretAccessKey: opts.secretAccessKey,
        ...(opts.endpoint !== undefined ? { endpoint: opts.endpoint } : {}),
        ...(opts.tls !== undefined ? { tls: opts.tls } : {}),
        cacheTtlMs: 0,
      }),
    );
  }

  protected fetchSecret(name: string): Promise<string> {
    return this.fetcher(name);
  }
}

// ── AzureKeyVaultProvider ─────────────────────────────────────────────────────

/** Options for the Phase 8 {@link AzureKeyVaultProvider}. */
export interface AzureKeyVaultProviderOptions extends SecretProviderBaseOptions {
  vaultUrl?: string;
  accessToken?: string;
  tokenProvider?: () => Promise<{ token: string; expiresAt: number }>;
  apiVersion?: string;
  tls?: HttpClientOptions;
  /** Injected retrieval seam (e.g. a mocked SDK client) used in place of HTTP. */
  fetcher?: SecretFetcher;
}

/**
 * Azure Key Vault adapter. Delegates to the SDK-free cloud provider (bearer
 * token over `node:https`) configured for refresh-on-read, or to an injected
 * {@link SecretFetcher} for testing (R9.2/R9.3/R9.6).
 */
export class AzureKeyVaultProvider extends RefreshOnReadProvider {
  private readonly fetcher: SecretFetcher;

  constructor(opts: AzureKeyVaultProviderOptions) {
    super(opts);
    if (opts.fetcher) {
      this.fetcher = opts.fetcher;
    } else {
      if (!opts.vaultUrl) {
        throw new Error('AzureKeyVaultProvider: vaultUrl is required when no fetcher is provided');
      }
      this.fetcher = buildCloudFetcher(
        new CloudAzureKeyVaultProvider({
          vaultUrl: opts.vaultUrl,
          ...(opts.accessToken !== undefined ? { accessToken: opts.accessToken } : {}),
          ...(opts.tokenProvider !== undefined ? { tokenProvider: opts.tokenProvider } : {}),
          ...(opts.apiVersion !== undefined ? { apiVersion: opts.apiVersion } : {}),
          ...(opts.tls !== undefined ? { tls: opts.tls } : {}),
          cacheTtlMs: 0,
        }),
      );
    }
  }

  protected fetchSecret(name: string): Promise<string> {
    return this.fetcher(name);
  }
}

// ── GcpSecretManagerProvider ──────────────────────────────────────────────────

/** Options for the Phase 8 {@link GcpSecretManagerProvider}. */
export interface GcpSecretManagerProviderOptions extends SecretProviderBaseOptions {
  projectId?: string;
  serviceAccountToken?: string;
  endpoint?: string;
  tls?: HttpClientOptions;
  /** Injected retrieval seam (e.g. a mocked SDK client) used in place of HTTP. */
  fetcher?: SecretFetcher;
}

/**
 * GCP Secret Manager adapter. Delegates to the SDK-free cloud provider (bearer
 * token over `node:https`) configured for refresh-on-read, or to an injected
 * {@link SecretFetcher} for testing (R9.2/R9.3/R9.6).
 */
export class GcpSecretManagerProvider extends RefreshOnReadProvider {
  private readonly fetcher: SecretFetcher;

  constructor(opts: GcpSecretManagerProviderOptions) {
    super(opts);
    if (opts.fetcher) {
      this.fetcher = opts.fetcher;
    } else {
      if (!opts.projectId) {
        throw new Error('GcpSecretManagerProvider: projectId is required when no fetcher is provided');
      }
      this.fetcher = buildCloudFetcher(
        new CloudGcpSecretManagerProvider({
          projectId: opts.projectId,
          ...(opts.serviceAccountToken !== undefined ? { serviceAccountToken: opts.serviceAccountToken } : {}),
          ...(opts.endpoint !== undefined ? { endpoint: opts.endpoint } : {}),
          ...(opts.tls !== undefined ? { tls: opts.tls } : {}),
          cacheTtlMs: 0,
        }),
      );
    }
  }

  protected fetchSecret(name: string): Promise<string> {
    return this.fetcher(name);
  }
}

/** Wrap a cloud SecretProvider as a {@link SecretFetcher}. */
function buildCloudFetcher(provider: CloudSecretProvider): SecretFetcher {
  return (name: string) => provider.get(name);
}

// ── Required-secret startup gate (R9.5) ───────────────────────────────────────

/** Options for {@link requireSecrets}. */
export interface RequireSecretsOptions {
  /**
   * Termination hook invoked when a required secret is missing; defaults to
   * `process.exit`. Injectable so the gate is testable without killing the test
   * runner.
   */
  exit?: (code: number) => never;
  /**
   * Log sink for the missing-secret message; defaults to writing to stderr.
   * Only secret NAMES are ever passed here — never values (R9.5).
   */
  log?: (message: string) => void;
}

/**
 * Startup gate enforcing that every required secret can be retrieved (R9.5).
 *
 * Each name is fetched through `provider`. On success the value is registered
 * for redaction and returned in the result map. If any required secret cannot be
 * retrieved (missing, empty, or upstream error), the gate emits ONLY the missing
 * names — never any value or upstream error detail, which could leak a value —
 * and terminates the process with a non-zero exit code, mirroring
 * `vault.loadConfig`'s required-variable behavior.
 *
 * @returns a map of name → value for all required secrets when every one
 *   resolves. When a secret is missing the gate does not return (it exits).
 */
export async function requireSecrets(
  provider: SecretProvider,
  names: readonly string[],
  opts: RequireSecretsOptions = {},
): Promise<Record<string, string>> {
  const resolved: Record<string, string> = {};
  const missing: string[] = [];

  for (const name of names) {
    try {
      const value = await provider.get(name);
      if (value === undefined || value === '') {
        missing.push(name);
        continue;
      }
      registerSecretForRedaction(value);
      resolved[name] = value;
    } catch {
      // Deliberately swallow the upstream error: it may embed a secret value.
      // Only the NAME is surfaced below (R9.5).
      missing.push(name);
    }
  }

  if (missing.length > 0) {
    const log = opts.log ?? ((message: string) => process.stderr.write(`${message}\n`));
    log(`Missing required secret(s): ${missing.join(', ')}`);
    const exit = opts.exit ?? ((code: number): never => process.exit(code));
    exit(1);
  }

  return resolved;
}
