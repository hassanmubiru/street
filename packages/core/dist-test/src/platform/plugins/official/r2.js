// src/platform/plugins/official/r2.ts
// Official reference plugin: Cloudflare R2 object storage. R2 is S3-compatible,
// so this reuses the framework's verified AWS SigV4 signer against the R2
// endpoint. Deterministic, offline-verifiable request signing.
import { PluginModule } from '../sdk.js';
import { PluginError } from '../host.js';
import { signAwsV4 } from '../../../enterprise/storage-adapters.js';
export const R2_PLUGIN_NAME = 'street-plugin-r2';
export const R2_PLUGIN_VERSION = '1.0.0';
export function r2PluginManifest() {
    return {
        name: R2_PLUGIN_NAME, version: R2_PLUGIN_VERSION,
        capabilities: ['storage', 'object-storage', 'r2'], permissions: ['net', 'secrets', 'middleware'],
    };
}
export function validateR2Config(input) {
    if (typeof input !== 'object' || input === null)
        throw new PluginError('R2 plugin config must be an object');
    const o = input;
    for (const k of ['accountId', 'bucket', 'accessKeyId', 'secretAccessKey']) {
        if (typeof o[k] !== 'string' || o[k].trim() === '')
            throw new PluginError(`R2 plugin config: "${k}" is required and must be a non-empty string`);
    }
    if (o['stateKey'] !== undefined && typeof o['stateKey'] !== 'string')
        throw new PluginError('R2 plugin config: "stateKey" must be a string');
    return {
        accountId: o['accountId'], bucket: o['bucket'],
        accessKeyId: o['accessKeyId'], secretAccessKey: o['secretAccessKey'],
        ...(o['stateKey'] !== undefined ? { stateKey: o['stateKey'] } : {}),
    };
}
/** SHA-256 hex of empty payload (used for GET requests). */
const EMPTY_SHA256 = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
export class R2Client {
    config;
    host;
    constructor(config) {
        this.config = config;
        this.host = `${config.accountId}.r2.cloudflarestorage.com`;
    }
    objectPath(key) {
        const full = `${this.config.bucket}/${key}`;
        return '/' + full.split('/').map(encodeURIComponent).join('/');
    }
    /** Build deterministic SigV4 headers for an R2 object request (service 's3', region 'auto'). */
    signedObjectHeaders(method, key, payloadHash = EMPTY_SHA256, now) {
        if (!key)
            throw new PluginError('R2: object key is required');
        return signAwsV4({
            method, host: this.host, path: this.objectPath(key),
            region: 'auto', service: 's3',
            accessKeyId: this.config.accessKeyId, secretAccessKey: this.config.secretAccessKey,
            payloadHash, ...(now ? { now } : {}),
        });
    }
    /** The R2 endpoint host. */
    endpoint() { return this.host; }
}
export class R2Plugin extends PluginModule {
    name = R2_PLUGIN_NAME;
    version = R2_PLUGIN_VERSION;
    raw;
    config = null;
    client = null;
    constructor(config) { super(); this.raw = config; }
    async onInstall() { this.config = validateR2Config(this.raw); }
    async onLoad(app) {
        const cfg = this._config();
        this.client = new R2Client(cfg);
        const stateKey = cfg.stateKey ?? 'r2';
        const client = this.client;
        const mw = async (ctx, next) => { ctx.state[stateKey] = client; await next(); };
        app.use(mw);
    }
    async onUnload() { this.client = null; }
    get storage() { if (!this.client)
        throw new PluginError('R2 plugin is not loaded'); return this.client; }
    _config() { if (!this.config)
        this.config = validateR2Config(this.raw); return this.config; }
}
//# sourceMappingURL=r2.js.map