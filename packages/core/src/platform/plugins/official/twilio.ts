// src/platform/plugins/official/twilio.ts
// Official reference plugin: Twilio SMS. Deterministic, offline-verifiable
// request building (HTTP Basic auth + form-encoded body) for the Twilio REST API.

import { request as httpsRequest } from 'node:https';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { PluginModule, type SandboxedApp } from '../sdk.js';
import { PluginError, type PluginManifest } from '../host.js';
import type { MiddlewareFn } from '../../../core/types.js';

export const TWILIO_PLUGIN_NAME = 'street-plugin-twilio';
export const TWILIO_PLUGIN_VERSION = '1.0.0';

/** Default outbound-request timeout (ms) when config omits `timeoutMs`. */
export const TWILIO_DEFAULT_TIMEOUT_MS = 30_000;

export interface TwilioPluginConfig { accountSid: string; authToken: string; defaultFrom?: string; stateKey?: string; timeoutMs?: number; }
export interface TwilioHttpRequest { method: 'POST'; url: string; headers: Record<string, string>; body: string; }
export interface SmsMessage { to: string; body: string; from?: string; }

export function twilioPluginManifest(): PluginManifest {
  return {
    name: TWILIO_PLUGIN_NAME, version: TWILIO_PLUGIN_VERSION,
    capabilities: ['sms', 'notifications', 'twilio'], permissions: ['net', 'secrets', 'middleware'],
  };
}

export function validateTwilioConfig(input: unknown): TwilioPluginConfig {
  if (typeof input !== 'object' || input === null) throw new PluginError('Twilio plugin config must be an object');
  const o = input as Record<string, unknown>;
  for (const k of ['accountSid', 'authToken']) {
    if (typeof o[k] !== 'string' || (o[k] as string).trim() === '') throw new PluginError(`Twilio plugin config: "${k}" is required and must be a non-empty string`);
  }
  for (const k of ['defaultFrom', 'stateKey']) {
    if (o[k] !== undefined && typeof o[k] !== 'string') throw new PluginError(`Twilio plugin config: "${k}" must be a string`);
  }
  if (o['timeoutMs'] !== undefined && (typeof o['timeoutMs'] !== 'number' || !Number.isInteger(o['timeoutMs']) || o['timeoutMs'] <= 0)) {
    throw new PluginError('Twilio plugin config: "timeoutMs" must be a positive integer (milliseconds)');
  }
  return {
    accountSid: o['accountSid'] as string, authToken: o['authToken'] as string,
    ...(o['defaultFrom'] !== undefined ? { defaultFrom: o['defaultFrom'] as string } : {}),
    ...(o['stateKey'] !== undefined ? { stateKey: o['stateKey'] as string } : {}),
    ...(o['timeoutMs'] !== undefined ? { timeoutMs: o['timeoutMs'] as number } : {}),
  };
}

/**
 * Verify a Twilio request signature (the `X-Twilio-Signature` header). Pure
 * crypto, no network. Twilio signs the full request URL with the POST params
 * appended in lexicographic key order (key immediately followed by value),
 * HMAC-SHA1 with your account auth token, base64-encoded. The comparison is
 * constant-time. Returns `true` only on a match.
 *
 * @param authToken  Twilio account auth token (the signing secret).
 * @param url        The full URL Twilio requested (exactly as configured).
 * @param params     The POST form parameters Twilio sent.
 * @param signature  The `X-Twilio-Signature` header value.
 */
export function verifyTwilioSignature(
  authToken: string,
  url: string,
  params: Record<string, string>,
  signature: string,
): boolean {
  if (typeof authToken !== 'string' || authToken === '' || typeof url !== 'string' || typeof signature !== 'string' || signature === '') {
    return false;
  }
  let data = url;
  for (const key of Object.keys(params).sort()) data += key + params[key];
  const expected = createHmac('sha1', authToken).update(Buffer.from(data, 'utf8')).digest();
  let provided: Buffer;
  try { provided = Buffer.from(signature, 'base64'); } catch { return false; }
  return provided.length === expected.length && timingSafeEqual(provided, expected);
}

export class TwilioClient {
  constructor(private readonly config: TwilioPluginConfig) {}

  /** Build a Twilio "create message" request (Basic auth + form body). */
  buildSendSmsRequest(msg: SmsMessage): TwilioHttpRequest {
    const from = msg.from ?? this.config.defaultFrom;
    if (!from) throw new PluginError('Twilio: no "from" number (set message.from or config.defaultFrom)');
    if (!msg.to) throw new PluginError('Twilio: message "to" is required');
    if (!msg.body) throw new PluginError('Twilio: message "body" is required');
    const basic = Buffer.from(`${this.config.accountSid}:${this.config.authToken}`).toString('base64');
    const form = new URLSearchParams({ To: msg.to, From: from, Body: msg.body });
    return {
      method: 'POST',
      url: `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(this.config.accountSid)}/Messages.json`,
      headers: { authorization: `Basic ${basic}`, 'content-type': 'application/x-www-form-urlencoded' },
      body: form.toString(),
    };
  }

  async send(msg: SmsMessage): Promise<number> {
    const r = this.buildSendSmsRequest(msg); const u = new URL(r.url);
    const timeoutMs = this.config.timeoutMs ?? TWILIO_DEFAULT_TIMEOUT_MS;
    return new Promise<number>((resolve, reject) => {
      const req = httpsRequest({ method: r.method, hostname: u.hostname, path: u.pathname, timeout: timeoutMs, headers: { ...r.headers, 'content-length': Buffer.byteLength(r.body).toString() } },
        (res) => { res.resume(); res.once('end', () => resolve(res.statusCode ?? 0)); });
      req.once('error', reject);
      req.once('timeout', () => req.destroy(new PluginError(`Twilio: request timed out after ${timeoutMs}ms`)));
      req.end(r.body);
    });
  }
}

export class TwilioPlugin extends PluginModule {
  readonly name = TWILIO_PLUGIN_NAME;
  readonly version = TWILIO_PLUGIN_VERSION;
  private readonly raw: unknown;
  private config: TwilioPluginConfig | null = null;
  private client: TwilioClient | null = null;
  constructor(config: unknown) { super(); this.raw = config; }
  async onInstall(): Promise<void> { this.config = validateTwilioConfig(this.raw); }
  async onLoad(app: SandboxedApp): Promise<void> {
    const cfg = this._config(); this.client = new TwilioClient(cfg);
    const stateKey = cfg.stateKey ?? 'sms'; const client = this.client;
    const mw: MiddlewareFn = async (ctx, next) => { (ctx.state as Record<string, unknown>)[stateKey] = client; await next(); };
    app.use(mw);
  }
  async onUnload(): Promise<void> { this.client = null; }
  get sms(): TwilioClient { if (!this.client) throw new PluginError('Twilio plugin is not loaded'); return this.client; }
  private _config(): TwilioPluginConfig { if (!this.config) this.config = validateTwilioConfig(this.raw); return this.config; }
}
