// src/platform/plugins/official/stripe.ts
// Official reference plugin: Stripe payments. Deterministic, offline-verifiable
// request building (bearer auth + form-encoded body) for the Stripe REST API.
import { request as httpsRequest } from 'node:https';
import { PluginModule } from '../sdk.js';
import { PluginError } from '../host.js';
export const STRIPE_PLUGIN_NAME = 'street-plugin-stripe';
export const STRIPE_PLUGIN_VERSION = '1.0.0';
export function stripePluginManifest() {
    return {
        name: STRIPE_PLUGIN_NAME, version: STRIPE_PLUGIN_VERSION,
        capabilities: ['payments', 'billing', 'stripe'], permissions: ['net', 'secrets', 'middleware'],
    };
}
export function validateStripeConfig(input) {
    if (typeof input !== 'object' || input === null)
        throw new PluginError('Stripe plugin config must be an object');
    const o = input;
    if (typeof o['apiKey'] !== 'string' || o['apiKey'].trim() === '') {
        throw new PluginError('Stripe plugin config: "apiKey" is required and must be a non-empty string');
    }
    if (o['stateKey'] !== undefined && typeof o['stateKey'] !== 'string')
        throw new PluginError('Stripe plugin config: "stateKey" must be a string');
    return { apiKey: o['apiKey'], ...(o['stateKey'] !== undefined ? { stateKey: o['stateKey'] } : {}) };
}
export class StripeClient {
    config;
    constructor(config) {
        this.config = config;
    }
    /** Build a Stripe API POST request (bearer auth + x-www-form-urlencoded). */
    buildRequest(resource, params) {
        if (!resource || resource.includes('..'))
            throw new PluginError('Stripe: invalid resource');
        const form = new URLSearchParams();
        for (const [k, v] of Object.entries(params))
            form.append(k, String(v));
        return {
            method: 'POST',
            url: `https://api.stripe.com/v1/${resource.replace(/^\//, '')}`,
            headers: { authorization: `Bearer ${this.config.apiKey}`, 'content-type': 'application/x-www-form-urlencoded' },
            body: form.toString(),
        };
    }
    /** Build a PaymentIntent creation request. */
    buildCreatePaymentIntent(amount, currency) {
        if (!Number.isInteger(amount) || amount <= 0)
            throw new PluginError('Stripe: amount must be a positive integer (minor units)');
        return this.buildRequest('payment_intents', { amount, currency });
    }
    async post(resource, params) {
        const r = this.buildRequest(resource, params);
        const u = new URL(r.url);
        return new Promise((resolve, reject) => {
            const req = httpsRequest({ method: r.method, hostname: u.hostname, path: u.pathname, headers: { ...r.headers, 'content-length': Buffer.byteLength(r.body).toString() } }, (res) => { res.resume(); res.once('end', () => resolve(res.statusCode ?? 0)); });
            req.once('error', reject);
            req.end(r.body);
        });
    }
}
export class StripePlugin extends PluginModule {
    name = STRIPE_PLUGIN_NAME;
    version = STRIPE_PLUGIN_VERSION;
    raw;
    config = null;
    client = null;
    constructor(config) { super(); this.raw = config; }
    async onInstall() { this.config = validateStripeConfig(this.raw); }
    async onLoad(app) {
        const cfg = this._config();
        this.client = new StripeClient(cfg);
        const stateKey = cfg.stateKey ?? 'stripe';
        const client = this.client;
        const mw = async (ctx, next) => { ctx.state[stateKey] = client; await next(); };
        app.use(mw);
    }
    async onUnload() { this.client = null; }
    get payments() { if (!this.client)
        throw new PluginError('Stripe plugin is not loaded'); return this.client; }
    _config() { if (!this.config)
        this.config = validateStripeConfig(this.raw); return this.config; }
}
//# sourceMappingURL=stripe.js.map