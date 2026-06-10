import { PluginModule, type SandboxedApp } from '../sdk.js';
import { type PluginManifest } from '../host.js';
export declare const R2_PLUGIN_NAME = "street-plugin-r2";
export declare const R2_PLUGIN_VERSION = "1.0.0";
export interface R2PluginConfig {
    accountId: string;
    bucket: string;
    accessKeyId: string;
    secretAccessKey: string;
    stateKey?: string;
}
export declare function r2PluginManifest(): PluginManifest;
export declare function validateR2Config(input: unknown): R2PluginConfig;
export declare class R2Client {
    private readonly config;
    private readonly host;
    constructor(config: R2PluginConfig);
    private objectPath;
    /** Build deterministic SigV4 headers for an R2 object request (service 's3', region 'auto'). */
    signedObjectHeaders(method: 'GET' | 'PUT', key: string, payloadHash?: string, now?: Date): Record<string, string>;
    /** The R2 endpoint host. */
    endpoint(): string;
}
export declare class R2Plugin extends PluginModule {
    readonly name = "street-plugin-r2";
    readonly version = "1.0.0";
    private readonly raw;
    private config;
    private client;
    constructor(config: unknown);
    onInstall(): Promise<void>;
    onLoad(app: SandboxedApp): Promise<void>;
    onUnload(): Promise<void>;
    get storage(): R2Client;
    private _config;
}
//# sourceMappingURL=r2.d.ts.map