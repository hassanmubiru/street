// src/platform/plugins/official/twilio.ts
// Official reference plugin: Twilio SMS. Deterministic, offline-verifiable
// request building (HTTP Basic auth + form-encoded body) for the Twilio REST API.
import { request as httpsRequest } from 'node:https';
import { PluginModule } from '../sdk.js';
import { PluginError } from '../host.js';
export const TWILIO_PLUGIN_NAME = 'street-plugin-twilio';
export const TWILIO_PLUGIN_VERSION = '1.0.0';
export function twilioPluginManifest() {
    return {
        name: TWILIO_PLUGIN_NAME, version: TWILIO_PLUGIN_VERSION,
        capabilities: ['sms', 'notifications', 'twilio'], permissions: ['net', 'secrets', 'middleware'],
    };
}
export function validateTwilioConfig(input) {
    if (typeof input !== 'object' || input === null)
        throw new PluginError('Twilio plugin config must be an object');
    const o = input;
    for (const k of ['accountSid', 'authToken']) {
        if (typeof o[k] !== 'string' || o[k].trim() === '')
            throw new PluginError(`Twilio plugin config: "${k}" is required and must be a non-empty string`);
    }
    for (const k of ['defaultFrom', 'stateKey']) {
        if (o[k] !== undefined && typeof o[k] !== 'string')
            throw new PluginError(`Twilio plugin config: "${k}" must be a string`);
    }
    return {
        accountSid: o['accountSid'], authToken: o['authToken'],
        ...(o['defaultFrom'] !== undefined ? { defaultFrom: o['defaultFrom'] } : {}),
        ...(o['stateKey'] !== undefined ? { stateKey: o['stateKey'] } : {}),
    };
}
export class TwilioClient {
    config;
    constructor(config) {
        this.config = config;
    }
    /** Build a Twilio "create message" request (Basic auth + form body). */
    buildSendSmsRequest(msg) {
        const from = msg.from ?? this.config.defaultFrom;
        if (!from)
            throw new PluginError('Twilio: no "from" number (set message.from or config.defaultFrom)');
        if (!msg.to)
            throw new PluginError('Twilio: message "to" is required');
        if (!msg.body)
            throw new PluginError('Twilio: message "body" is required');
        const basic = Buffer.from(`${this.config.accountSid}:${this.config.authToken}`).toString('base64');
        const form = new URLSearchParams({ To: msg.to, From: from, Body: msg.body });
        return {
            method: 'POST',
            url: `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(this.config.accountSid)}/Messages.json`,
            headers: { authorization: `Basic ${basic}`, 'content-type': 'application/x-www-form-urlencoded' },
            body: form.toString(),
        };
    }
    async send(msg) {
        const r = this.buildSendSmsRequest(msg);
        const u = new URL(r.url);
        return new Promise((resolve, reject) => {
            const req = httpsRequest({ method: r.method, hostname: u.hostname, path: u.pathname, headers: { ...r.headers, 'content-length': Buffer.byteLength(r.body).toString() } }, (res) => { res.resume(); res.once('end', () => resolve(res.statusCode ?? 0)); });
            req.once('error', reject);
            req.end(r.body);
        });
    }
}
export class TwilioPlugin extends PluginModule {
    name = TWILIO_PLUGIN_NAME;
    version = TWILIO_PLUGIN_VERSION;
    raw;
    config = null;
    client = null;
    constructor(config) { super(); this.raw = config; }
    async onInstall() { this.config = validateTwilioConfig(this.raw); }
    async onLoad(app) {
        const cfg = this._config();
        this.client = new TwilioClient(cfg);
        const stateKey = cfg.stateKey ?? 'sms';
        const client = this.client;
        const mw = async (ctx, next) => { ctx.state[stateKey] = client; await next(); };
        app.use(mw);
    }
    async onUnload() { this.client = null; }
    get sms() { if (!this.client)
        throw new PluginError('Twilio plugin is not loaded'); return this.client; }
    _config() { if (!this.config)
        this.config = validateTwilioConfig(this.raw); return this.config; }
}
//# sourceMappingURL=twilio.js.map