import { PluginModule, type SandboxedApp } from '../sdk.js';
import { type PluginManifest } from '../host.js';
export declare const STRIPE_PLUGIN_NAME = "street-plugin-stripe";
export declare const STRIPE_PLUGIN_VERSION = "1.0.0";
export interface StripePluginConfig {
    apiKey: string;
    stateKey?: string;
}
export interface StripeHttpRequest {
    method: 'POST';
    url: string;
    headers: Record<string, string>;
    body: string;
}
export declare function stripePluginManifest(): PluginManifest;
export declare function validateStripeConfig(input: unknown): StripePluginConfig;
export declare class StripeClient {
    private readonly config;
    constructor(config: StripePluginConfig);
    /** Build a Stripe API POST request (bearer auth + x-www-form-urlencoded). */
    buildRequest(resource: string, params: Record<string, string | number>): StripeHttpRequest;
    /** Build a PaymentIntent creation request. */
    buildCreatePaymentIntent(amount: number, currency: string): StripeHttpRequest;
    post(resource: string, params: Record<string, string | number>): Promise<number>;
}
export declare class StripePlugin extends PluginModule {
    readonly name = "street-plugin-stripe";
    readonly version = "1.0.0";
    private readonly raw;
    private config;
    private client;
    constructor(config: unknown);
    onInstall(): Promise<void>;
    onLoad(app: SandboxedApp): Promise<void>;
    onUnload(): Promise<void>;
    get payments(): StripeClient;
    private _config;
}
//# sourceMappingURL=stripe.d.ts.map