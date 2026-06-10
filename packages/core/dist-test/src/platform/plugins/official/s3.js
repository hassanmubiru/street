// src/platform/plugins/official/s3.ts
// Official reference plugin: AWS S3 object storage, built on the PluginHost
// contract and the framework's existing SigV4 signer + S3StorageAdapter.
// Dependency-free (node:crypto/https via the adapter). Demonstrates the full
// plugin surface: manifest, capability metadata, permission declaration,
// configuration schema, lifecycle hooks, and sandbox middleware integration.
import { PluginModule } from '../sdk.js';
import { PluginError } from '../host.js';
import { S3StorageAdapter, signAwsV4 } from '../../../enterprise/storage-adapters.js';
export const S3_PLUGIN_NAME = 'street-plugin-s3';
export const S3_PLUGIN_VERSION = '1.0.0';
/** The unsigned manifest for the S3 plugin (sign it via {@link signManifest}). */
export function s3PluginManifest() {
    return {
        name: S3_PLUGIN_NAME,
        version: S3_PLUGIN_VERSION,
        capabilities: ['storage', 'object-storage', 's3'],
        permissions: ['net', 'secrets', 'middleware'],
    };
}
/**
 * Validate raw config against the S3 plugin's schema. Throws {@link PluginError}
 * with a precise message on the first violation.
 */
export function validateS3Config(input) {
    if (typeof input !== 'object' || input === null) {
        throw new PluginError('S3 plugin config must be an object');
    }
    const o = input;
    const reqStr = (k) => {
        const v = o[k];
        if (typeof v !== 'string' || v.trim() === '') {
            throw new PluginError(`S3 plugin config: "${String(k)}" is required and must be a non-empty string`);
        }
        return v;
    };
    const optStr = (k) => {
        const v = o[k];
        if (v === undefined)
            return undefined;
        if (typeof v !== 'string')
            throw new PluginError(`S3 plugin config: "${k}" must be a string`);
        return v;
    };
    return {
        bucket: reqStr('bucket'),
        region: reqStr('region'),
        accessKeyId: reqStr('accessKeyId'),
        secretAccessKey: reqStr('secretAccessKey'),
        prefix: optStr('prefix'),
        stateKey: optStr('stateKey'),
    };
}
/**
 * AWS S3 storage plugin. On load, it injects an {@link S3StorageAdapter} into
 * each request's `ctx.state[stateKey]` via middleware (requires the 'middleware'
 * permission). Exposes deterministic SigV4 request signing for offline tests.
 */
export class S3Plugin extends PluginModule {
    name = S3_PLUGIN_NAME;
    version = S3_PLUGIN_VERSION;
    raw;
    config = null;
    adapter = null;
    constructor(config) {
        super();
        this.raw = config;
    }
    /** Validate configuration once at install time. */
    async onInstall() {
        this.config = validateS3Config(this.raw);
    }
    /** Build the adapter and register the injection middleware. */
    async onLoad(app) {
        const cfg = this._config();
        const opts = {
            bucket: cfg.bucket, region: cfg.region,
            accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey,
            ...(cfg.prefix !== undefined ? { prefix: cfg.prefix } : {}),
        };
        this.adapter = new S3StorageAdapter(opts);
        const stateKey = cfg.stateKey ?? 's3';
        const adapter = this.adapter;
        const mw = async (ctx, next) => {
            ctx.state[stateKey] = adapter;
            await next();
        };
        app.use(mw);
    }
    /** Release the adapter. */
    async onUnload() {
        this.adapter = null;
    }
    /** The live storage adapter (only after onLoad). */
    get storage() {
        if (!this.adapter)
            throw new PluginError('S3 plugin is not loaded');
        return this.adapter;
    }
    _config() {
        if (!this.config)
            this.config = validateS3Config(this.raw);
        return this.config;
    }
    /**
     * Compute deterministic AWS SigV4 headers for an S3 object request. Used by
     * the plugin internally and exposed for offline verification of the signing
     * logic (same inputs → same signature, no network).
     */
    signedObjectHeaders(method, key, payloadHash, now) {
        const cfg = this._config();
        const host = `${cfg.bucket}.s3.${cfg.region}.amazonaws.com`;
        const full = (cfg.prefix ? `${cfg.prefix.replace(/\/$/, '')}/` : '') + key;
        const path = '/' + full.split('/').map(encodeURIComponent).join('/');
        return signAwsV4({
            method, host, path, region: cfg.region, service: 's3',
            accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey,
            payloadHash, ...(now ? { now } : {}),
        });
    }
}
//# sourceMappingURL=s3.js.map