import { PluginModule, type SandboxedApp } from '../sdk.js';
import { type PluginManifest } from '../host.js';
export declare const AUTH0_PLUGIN_NAME = "street-plugin-auth0";
export declare const AUTH0_PLUGIN_VERSION = "1.0.0";
export interface Auth0PluginConfig {
    domain: string;
    clientId: string;
    clientSecret: string;
    audience?: string;
    stateKey?: string;
}
export interface Auth0HttpRequest {
    method: 'POST';
    url: string;
    headers: Record<string, string>;
    body: string;
}
export declare function auth0PluginManifest(): PluginManifest;
export declare function validateAuth0Config(input: unknown): Auth0PluginConfig;
export declare class Auth0Client {
    private readonly config;
    constructor(config: Auth0PluginConfig);
    /** Build the OAuth2 client-credentials token request (JSON body). */
    buildTokenRequest(audience?: string): Auth0HttpRequest;
    getToken(audience?: string): Promise<number>;
}
export declare class Auth0Plugin extends PluginModule {
    readonly name = "street-plugin-auth0";
    readonly version = "1.0.0";
    private readonly raw;
    private config;
    private client;
    constructor(config: unknown);
    onInstall(): Promise<void>;
    onLoad(app: SandboxedApp): Promise<void>;
    onUnload(): Promise<void>;
    get identity(): Auth0Client;
    private _config;
}
//# sourceMappingURL=auth0.d.ts.map