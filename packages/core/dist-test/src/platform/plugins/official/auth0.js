// src/platform/plugins/official/auth0.ts
// Official reference plugin: Auth0. Deterministic, offline-verifiable request
// building for the OAuth2 client-credentials token endpoint (JSON body).
import { request as httpsRequest } from 'node:https';
import { PluginModule } from '../sdk.js';
import { PluginError } from '../host.js';
export const AUTH0_PLUGIN_NAME = 'street-plugin-auth0';
export const AUTH0_PLUGIN_VERSION = '1.0.0';
export function auth0PluginManifest() {
    return {
        name: AUTH0_PLUGIN_NAME, version: AUTH0_PLUGIN_VERSION,
        capabilities: ['auth', 'identity', 'auth0'], permissions: ['net', 'secrets', 'middleware'],
    };
}
export function validateAuth0Config(input) {
    if (typeof input !== 'object' || input === null)
        throw new PluginError('Auth0 plugin config must be an object');
    const o = input;
    for (const k of ['domain', 'clientId', 'clientSecret']) {
        if (typeof o[k] !== 'string' || o[k].trim() === '')
            throw new PluginError(`Auth0 plugin config: "${k}" is required and must be a non-empty string`);
    }
    for (const k of ['audience', 'stateKey']) {
        if (o[k] !== undefined && typeof o[k] !== 'string')
            throw new PluginError(`Auth0 plugin config: "${k}" must be a string`);
    }
    // Normalise domain: strip protocol and trailing slash.
    const domain = o['domain'].replace(/^https?:\/\//, '').replace(/\/$/, '');
    return {
        domain, clientId: o['clientId'], clientSecret: o['clientSecret'],
        ...(o['audience'] !== undefined ? { audience: o['audience'] } : {}),
        ...(o['stateKey'] !== undefined ? { stateKey: o['stateKey'] } : {}),
    };
}
export class Auth0Client {
    config;
    constructor(config) {
        this.config = config;
    }
    /** Build the OAuth2 client-credentials token request (JSON body). */
    buildTokenRequest(audience) {
        const aud = audience ?? this.config.audience;
        if (!aud)
            throw new PluginError('Auth0: no audience (set buildTokenRequest(audience) or config.audience)');
        const body = {
            client_id: this.config.clientId,
            client_secret: this.config.clientSecret,
            audience: aud,
            grant_type: 'client_credentials',
        };
        return {
            method: 'POST',
            url: `https://${this.config.domain}/oauth/token`,
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(body),
        };
    }
    async getToken(audience) {
        const r = this.buildTokenRequest(audience);
        const u = new URL(r.url);
        return new Promise((resolve, reject) => {
            const req = httpsRequest({ method: r.method, hostname: u.hostname, path: u.pathname, headers: { ...r.headers, 'content-length': Buffer.byteLength(r.body).toString() } }, (res) => { res.resume(); res.once('end', () => resolve(res.statusCode ?? 0)); });
            req.once('error', reject);
            req.end(r.body);
        });
    }
}
export class Auth0Plugin extends PluginModule {
    name = AUTH0_PLUGIN_NAME;
    version = AUTH0_PLUGIN_VERSION;
    raw;
    config = null;
    client = null;
    constructor(config) { super(); this.raw = config; }
    async onInstall() { this.config = validateAuth0Config(this.raw); }
    async onLoad(app) {
        const cfg = this._config();
        this.client = new Auth0Client(cfg);
        const stateKey = cfg.stateKey ?? 'auth0';
        const client = this.client;
        const mw = async (ctx, next) => { ctx.state[stateKey] = client; await next(); };
        app.use(mw);
    }
    async onUnload() { this.client = null; }
    get identity() { if (!this.client)
        throw new PluginError('Auth0 plugin is not loaded'); return this.client; }
    _config() { if (!this.config)
        this.config = validateAuth0Config(this.raw); return this.config; }
}
//# sourceMappingURL=auth0.js.map