// packages/plugin-clerk/src/index.ts
// Official StreetJS plugin: Clerk identity backend API.
//
// Dependency-free: request construction (bearer secret key + JSON) is pure and
// offline-verifiable; the network send uses node:https. Covers the common
// backend operations: get a user and list users.

import { PluginModule, PluginError, type SandboxedApp, type PluginManifest } from 'streetjs';
import { request as httpsRequest } from 'node:https';

export const CLERK_PLUGIN_NAME = 'street-plugin-clerk';
export const CLERK_PLUGIN_VERSION = '1.0.0';

export interface ClerkPluginConfig {
  /** Clerk backend secret key (sk_test_… / sk_live_…). */
  secretKey: string;
  /** Override base URL (default https://api.clerk.com/v1). */
  baseUrl?: string;
  /** State key under which the client is injected. Default 'clerk'. */
  stateKey?: string;
}

export interface ClerkHttpRequest {
  method: string;
  url: string;
  headers: Record<string, string>;
  body?: string;
}

export function clerkPluginManifest(): PluginManifest {
  return {
    name: CLERK_PLUGIN_NAME,
    version: CLERK_PLUGIN_VERSION,
    capabilities: ['auth', 'identity', 'clerk'],
    permissions: ['net', 'secrets', 'middleware'],
  };
}

export function validateClerkConfig(input: unknown): ClerkPluginConfig {
  if (typeof input !== 'object' || input === null) {
    throw new PluginError('Clerk plugin config must be an object');
  }
  const o = input as Record<string, unknown>;
  if (typeof o['secretKey'] !== 'string' || (o['secretKey'] as string).trim() === '') {
    throw new PluginError('Clerk plugin config: "secretKey" is required and must be a non-empty string');
  }
  for (const k of ['baseUrl', 'stateKey'] as const) {
    if (o[k] !== undefined && typeof o[k] !== 'string') {
      throw new PluginError(`Clerk plugin config: "${k}" must be a string`);
    }
  }
  if (o['baseUrl'] !== undefined && !/^https:\/\//.test(o['baseUrl'] as string)) {
    throw new PluginError('Clerk plugin config: "baseUrl" must be an https URL');
  }
  return {
    secretKey: o['secretKey'] as string,
    ...(o['baseUrl'] !== undefined ? { baseUrl: o['baseUrl'] as string } : {}),
    ...(o['stateKey'] !== undefined ? { stateKey: o['stateKey'] as string } : {}),
  };
}

/** Remove trailing '/' characters without a backtracking regex (ReDoS-safe). */
function stripTrailingSlashes(s: string): string {
  let end = s.length;
  while (end > 0 && s.charCodeAt(end - 1) === 47 /* '/' */) end--;
  return s.slice(0, end);
}

function base(cfg: ClerkPluginConfig): string {
  return stripTrailingSlashes(cfg.baseUrl ?? 'https://api.clerk.com/v1');
}

function authHeaders(cfg: ClerkPluginConfig): Record<string, string> {
  return { authorization: `Bearer ${cfg.secretKey}`, accept: 'application/json' };
}

/** A user id path segment must be non-empty and contain no slash or whitespace. */
function assertUserId(userId: string): void {
  if (typeof userId !== 'string' || userId.trim() === '' || /[\s/]/.test(userId)) {
    throw new PluginError(`Clerk: invalid userId "${userId}"`);
  }
}

/** Build a get-user request. */
export function buildGetUserRequest(cfg: ClerkPluginConfig, userId: string): ClerkHttpRequest {
  assertUserId(userId);
  return { method: 'GET', url: `${base(cfg)}/users/${encodeURIComponent(userId)}`, headers: authHeaders(cfg) };
}

/** Build a list-users request with optional pagination. */
export function buildListUsersRequest(
  cfg: ClerkPluginConfig,
  params: { limit?: number; offset?: number } = {},
): ClerkHttpRequest {
  const q = new URLSearchParams();
  if (params.limit !== undefined) q.set('limit', String(params.limit));
  if (params.offset !== undefined) q.set('offset', String(params.offset));
  const qs = q.toString();
  return { method: 'GET', url: `${base(cfg)}/users${qs ? `?${qs}` : ''}`, headers: authHeaders(cfg) };
}

export class ClerkClient {
  constructor(private readonly config: ClerkPluginConfig) {}

  private send(req: ClerkHttpRequest): Promise<{ status: number; body: string }> {
    const u = new URL(req.url);
    return new Promise((resolve, reject) => {
      const r = httpsRequest(
        { method: req.method, hostname: u.hostname, path: u.pathname + u.search, headers: req.headers },
        (res) => {
          let data = '';
          res.on('data', (c) => (data += c));
          res.on('end', () => resolve({ status: res.statusCode ?? 0, body: data }));
        },
      );
      r.on('error', (e) => reject(new PluginError(`Clerk request failed: ${e.message}`)));
      r.end(req.body);
    });
  }

  async getUser(userId: string): Promise<unknown> {
    const { status, body } = await this.send(buildGetUserRequest(this.config, userId));
    if (status < 200 || status >= 300) throw new PluginError(`Clerk get-user returned ${status}`);
    return JSON.parse(body);
  }

  async listUsers(params: { limit?: number; offset?: number } = {}): Promise<unknown> {
    const { status, body } = await this.send(buildListUsersRequest(this.config, params));
    if (status < 200 || status >= 300) throw new PluginError(`Clerk list-users returned ${status}`);
    return JSON.parse(body);
  }
}

export class ClerkPlugin extends PluginModule {
  readonly name = CLERK_PLUGIN_NAME;
  readonly version = CLERK_PLUGIN_VERSION;

  private readonly raw: unknown;
  private config: ClerkPluginConfig | null = null;
  private client: ClerkClient | null = null;

  constructor(config: unknown) {
    super();
    this.raw = config;
  }

  override async onInstall(): Promise<void> {
    this.config = validateClerkConfig(this.raw);
  }

  override async onLoad(app: SandboxedApp): Promise<void> {
    const cfg = this._config();
    this.client = new ClerkClient(cfg);
    const stateKey = cfg.stateKey ?? 'clerk';
    const client = this.client;
    app.use(async (ctx, next) => {
      (ctx.state as Record<string, unknown>)[stateKey] = client;
      await next();
    });
  }

  get identity(): ClerkClient {
    if (!this.client) throw new PluginError('Clerk plugin is not loaded');
    return this.client;
  }

  private _config(): ClerkPluginConfig {
    if (!this.config) this.config = validateClerkConfig(this.raw);
    return this.config;
  }
}
