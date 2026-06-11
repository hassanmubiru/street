// tests/secret-provider-adapters.test.ts
// Phase 8 integration tests for the SecretProvider adapters (Requirement 9).
//
// These tests exercise the four first-class adapters — GitHubSecretsProvider,
// AwsSecretsManagerProvider, AzureKeyVaultProvider, and GcpSecretManagerProvider —
// through the *injected retrieval seam* each adapter exposes (the `fetcher`
// option for the cloud adapters, and the `env` source for GitHub) so the upstream
// cloud SDKs/HTTP are stood in by an in-process mock. No network is used.
//
// Coverage per adapter:
//   - retrieval through the configured adapter (R9.2/R9.3)
//   - rotation-on-next-read: a value rotated upstream is observed on the next
//     get() without a restart, with the default TTL=0 (R9.6)
//   - log redaction: retrieved values are registered and masked by redact(),
//     including in the startup error path of requireSecrets (R9.4)
//
// The "single interface" requirement (R9.2) is asserted structurally by driving
// all four adapters through the shared `SecretProvider.get` contract in a table.

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  GitHubSecretsProvider,
  AwsSecretsManagerProvider,
  AzureKeyVaultProvider,
  GcpSecretManagerProvider,
  requireSecrets,
  redact,
  clearRedactionRegistry,
  REDACTION_PLACEHOLDER,
  type SecretProvider,
  type SecretFetcher,
} from '../security/secret-provider.js';

// ── Mock SDK harness ──────────────────────────────────────────────────────────

/**
 * A stand-in for a cloud secret-store SDK client. It holds a mutable name→value
 * map (so a test can "rotate" a value upstream), counts calls, and exposes a
 * {@link SecretFetcher} that adapters consume in place of a real SDK/HTTP call.
 */
class MockSecretSdk {
  readonly calls: string[] = [];
  private readonly store = new Map<string, string>();

  constructor(initial: Record<string, string> = {}) {
    for (const [k, v] of Object.entries(initial)) this.store.set(k, v);
  }

  /** Simulate an upstream rotation/update of a secret value. */
  rotate(name: string, value: string): void {
    this.store.set(name, value);
  }

  /** The injected retrieval seam handed to an adapter via its `fetcher` option. */
  readonly fetcher: SecretFetcher = async (name: string): Promise<string> => {
    this.calls.push(name);
    const value = this.store.get(name);
    if (value === undefined) {
      // A realistic SDK error that *embeds the requested name* — never a value.
      throw new Error(`MockSecretSdk: secret "${name}" not found`);
    }
    return value;
  };
}

/**
 * Build the four adapters over a single shared mock SDK so they can be driven
 * through the common `SecretProvider` contract. GitHub resolves from an env
 * source rather than a network fetcher, so it is backed by the same map via a
 * mutable env object.
 */
interface AdapterCase {
  name: string;
  provider: SecretProvider;
  rotate: (name: string, value: string) => void;
}

function buildCloudAdapter(
  factory: (fetcher: SecretFetcher) => SecretProvider,
  initial: Record<string, string>,
): { provider: SecretProvider; rotate: (name: string, value: string) => void } {
  const sdk = new MockSecretSdk(initial);
  return { provider: factory(sdk.fetcher), rotate: (n, v) => sdk.rotate(n, v) };
}

beforeEach(() => {
  // Each test starts with a clean redaction registry so masking assertions are
  // isolated from values registered by earlier tests.
  clearRedactionRegistry();
});

// ── Per-adapter retrieval + rotation-on-next-read (R9.2/R9.3/R9.6) ─────────────

describe('SecretProvider adapters — retrieval and rotation-on-next-read', () => {
  it('GitHubSecretsProvider retrieves from the env seam and observes rotation on next read', async () => {
    const env: NodeJS.ProcessEnv = { API_TOKEN: 'gh-v1' };
    const provider = new GitHubSecretsProvider({ env });

    assert.equal(await provider.get('API_TOKEN'), 'gh-v1'); // R9.3

    env.API_TOKEN = 'gh-v2'; // upstream rotation
    assert.equal(await provider.get('API_TOKEN'), 'gh-v2'); // R9.6 — no restart
  });

  it('AwsSecretsManagerProvider retrieves through the injected fetcher and observes rotation', async () => {
    const sdk = new MockSecretSdk({ 'prod/db': 'aws-v1' });
    const provider = new AwsSecretsManagerProvider({
      region: 'us-east-1',
      accessKeyId: 'AKID',
      secretAccessKey: 'secret',
      fetcher: sdk.fetcher,
    });

    assert.equal(await provider.get('prod/db'), 'aws-v1'); // R9.3
    sdk.rotate('prod/db', 'aws-v2'); // upstream rotation
    assert.equal(await provider.get('prod/db'), 'aws-v2'); // R9.6
    assert.deepEqual(sdk.calls, ['prod/db', 'prod/db'], 'TTL=0 re-reads upstream each get');
  });

  it('AzureKeyVaultProvider retrieves through the injected fetcher and observes rotation', async () => {
    const sdk = new MockSecretSdk({ 'conn-string': 'az-v1' });
    const provider = new AzureKeyVaultProvider({ fetcher: sdk.fetcher });

    assert.equal(await provider.get('conn-string'), 'az-v1'); // R9.3
    sdk.rotate('conn-string', 'az-v2');
    assert.equal(await provider.get('conn-string'), 'az-v2'); // R9.6
  });

  it('GcpSecretManagerProvider retrieves through the injected fetcher and observes rotation', async () => {
    const sdk = new MockSecretSdk({ 'api-key': 'gcp-v1' });
    const provider = new GcpSecretManagerProvider({ fetcher: sdk.fetcher });

    assert.equal(await provider.get('api-key'), 'gcp-v1'); // R9.3
    sdk.rotate('api-key', 'gcp-v2');
    assert.equal(await provider.get('api-key'), 'gcp-v2'); // R9.6
  });

  it('honors a positive TTL by caching, then observes rotation once the TTL elapses', async () => {
    let nowMs = 0;
    const sdk = new MockSecretSdk({ k: 'ttl-v1' });
    const provider = new AwsSecretsManagerProvider({
      region: 'us-east-1',
      accessKeyId: 'AKID',
      secretAccessKey: 'secret',
      fetcher: sdk.fetcher,
      ttlMs: 1_000,
      now: () => nowMs,
    });

    assert.equal(await provider.get('k'), 'ttl-v1');
    sdk.rotate('k', 'ttl-v2');
    // Within the TTL window the cached value is served (no extra upstream call).
    assert.equal(await provider.get('k'), 'ttl-v1');
    assert.equal(sdk.calls.length, 1);
    // Past the TTL the rotated value is observed without a restart (R9.6).
    nowMs = 1_500;
    assert.equal(await provider.get('k'), 'ttl-v2');
    assert.equal(sdk.calls.length, 2);
  });
});

// ── Single-interface contract across all four adapters (R9.2) ──────────────────

describe('SecretProvider adapters — single interface contract (R9.2)', () => {
  function allAdapters(): AdapterCase[] {
    const env: NodeJS.ProcessEnv = { SHARED: 'gh-shared' };
    const aws = buildCloudAdapter(
      (fetcher) => new AwsSecretsManagerProvider({ region: 'r', accessKeyId: 'a', secretAccessKey: 's', fetcher }),
      { SHARED: 'aws-shared' },
    );
    const azure = buildCloudAdapter((fetcher) => new AzureKeyVaultProvider({ fetcher }), { SHARED: 'az-shared' });
    const gcp = buildCloudAdapter((fetcher) => new GcpSecretManagerProvider({ fetcher }), { SHARED: 'gcp-shared' });
    return [
      { name: 'GitHub', provider: new GitHubSecretsProvider({ env }), rotate: (n, v) => { env[n] = v; } },
      { name: 'AWS', ...aws },
      { name: 'Azure', ...azure },
      { name: 'GCP', ...gcp },
    ];
  }

  it('every adapter implements get(name): Promise<string>', async () => {
    for (const { name, provider } of allAdapters()) {
      assert.equal(typeof provider.get, 'function', `${name} must expose get()`);
      const value = await provider.get('SHARED');
      assert.equal(typeof value, 'string', `${name}.get must resolve a string`);
      assert.ok(value.length > 0, `${name}.get must resolve a non-empty value`);
    }
  });
});

// ── Log redaction, including the startup error path (R9.4) ─────────────────────

describe('SecretProvider adapters — log redaction (R9.4)', () => {
  it('masks a retrieved value in subsequent log lines for each adapter', async () => {
    const env: NodeJS.ProcessEnv = { TOKEN: 'gh-secret-value' };
    const cases: Array<{ provider: SecretProvider; name: string; secret: string }> = [
      { provider: new GitHubSecretsProvider({ env }), name: 'TOKEN', secret: 'gh-secret-value' },
      {
        provider: new AwsSecretsManagerProvider({
          region: 'r', accessKeyId: 'a', secretAccessKey: 's',
          fetcher: new MockSecretSdk({ s: 'aws-secret-value' }).fetcher,
        }),
        name: 's', secret: 'aws-secret-value',
      },
      {
        provider: new AzureKeyVaultProvider({ fetcher: new MockSecretSdk({ s: 'az-secret-value' }).fetcher }),
        name: 's', secret: 'az-secret-value',
      },
      {
        provider: new GcpSecretManagerProvider({ fetcher: new MockSecretSdk({ s: 'gcp-secret-value' }).fetcher }),
        name: 's', secret: 'gcp-secret-value',
      },
    ];

    for (const { provider, name, secret } of cases) {
      const value = await provider.get(name);
      const line = `connecting with credential ${value} now`;
      const masked = redact(line);
      assert.ok(!masked.includes(secret), `retrieved value must not survive redaction (${secret})`);
      assert.ok(masked.includes(REDACTION_PLACEHOLDER), 'redaction placeholder must be present');
    }
  });

  it('requireSecrets startup error path emits only the missing NAME, never any value', async () => {
    // One required secret resolves (and is registered for redaction); another is
    // missing. The gate must terminate emitting only the missing name, and the
    // resolved value must not leak into the log output (R9.4/R9.5).
    const sdk = new MockSecretSdk({ PRESENT: 'present-secret-value' });
    const provider = new AwsSecretsManagerProvider({
      region: 'r', accessKeyId: 'a', secretAccessKey: 's', fetcher: sdk.fetcher,
    });

    const logs: string[] = [];
    let exitCode: number | undefined;

    await requireSecrets(provider, ['PRESENT', 'ABSENT'], {
      log: (m) => logs.push(m),
      exit: ((code: number) => { exitCode = code; return undefined as never; }),
    });

    assert.equal(exitCode, 1, 'missing required secret must exit non-zero');
    const combined = logs.join('\n');
    assert.ok(combined.includes('ABSENT'), 'the missing secret name must be emitted');
    assert.ok(!combined.includes('PRESENT'), 'a resolved secret name need not be emitted');
    assert.ok(!combined.includes('present-secret-value'), 'no secret value may appear in startup logs');
    // The SDK error for the missing secret embeds its NAME, not a value; even so,
    // redaction of the resolved value holds across any startup log line.
    assert.equal(redact(`startup failed: present-secret-value`), `startup failed: ${REDACTION_PLACEHOLDER}`);
  });

  it('requireSecrets returns resolved values and registers them for redaction on success', async () => {
    const sdk = new MockSecretSdk({ A: 'value-a', B: 'value-b' });
    const provider = new GcpSecretManagerProvider({ fetcher: sdk.fetcher });

    const resolved = await requireSecrets(provider, ['A', 'B']);
    assert.deepEqual(resolved, { A: 'value-a', B: 'value-b' });

    // Both resolved values are masked from any later log output (R9.4).
    assert.equal(redact('a=value-a b=value-b'), `a=${REDACTION_PLACEHOLDER} b=${REDACTION_PLACEHOLDER}`);
  });
});
