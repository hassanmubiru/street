import { PluginModule, type SandboxedApp } from '../sdk.js';
import { type PluginManifest } from '../host.js';
import { S3StorageAdapter } from '../../../enterprise/storage-adapters.js';
export declare const S3_PLUGIN_NAME = "street-plugin-s3";
export declare const S3_PLUGIN_VERSION = "1.0.0";
/** Configuration schema for the S3 plugin. */
export interface S3PluginConfig {
    bucket: string;
    region: string;
    accessKeyId: string;
    secretAccessKey: string;
    /** Optional key prefix within the bucket. */
    prefix?: string;
    /** State key under which the S3 adapter is injected by the middleware. Default 's3'. */
    stateKey?: string;
}
/** The unsigned manifest for the S3 plugin (sign it via {@link signManifest}). */
export declare function s3PluginManifest(): PluginManifest;
/**
 * Validate raw config against the S3 plugin's schema. Throws {@link PluginError}
 * with a precise message on the first violation.
 */
export declare function validateS3Config(input: unknown): S3PluginConfig;
/**
 * AWS S3 storage plugin. On load, it injects an {@link S3StorageAdapter} into
 * each request's `ctx.state[stateKey]` via middleware (requires the 'middleware'
 * permission). Exposes deterministic SigV4 request signing for offline tests.
 */
export declare class S3Plugin extends PluginModule {
    readonly name = "street-plugin-s3";
    readonly version = "1.0.0";
    private readonly raw;
    private config;
    private adapter;
    constructor(config: unknown);
    /** Validate configuration once at install time. */
    onInstall(): Promise<void>;
    /** Build the adapter and register the injection middleware. */
    onLoad(app: SandboxedApp): Promise<void>;
    /** Release the adapter. */
    onUnload(): Promise<void>;
    /** The live storage adapter (only after onLoad). */
    get storage(): S3StorageAdapter;
    private _config;
    /**
     * Compute deterministic AWS SigV4 headers for an S3 object request. Used by
     * the plugin internally and exposed for offline verification of the signing
     * logic (same inputs → same signature, no network).
     */
    signedObjectHeaders(method: 'GET' | 'PUT', key: string, payloadHash: string, now?: Date): Record<string, string>;
}
//# sourceMappingURL=s3.d.ts.map