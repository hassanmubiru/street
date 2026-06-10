import { PluginModule, type SandboxedApp } from '../sdk.js';
import { type PluginManifest } from '../host.js';
export declare const SENDGRID_PLUGIN_NAME = "street-plugin-sendgrid";
export declare const SENDGRID_PLUGIN_VERSION = "1.0.0";
export interface SendGridPluginConfig {
    apiKey: string;
    /** Default sender address used when a message omits `from`. */
    defaultFrom?: string;
    /** State key under which the mail client is injected. Default 'mail'. */
    stateKey?: string;
}
export interface MailMessage {
    to: string;
    subject: string;
    from?: string;
    text?: string;
    html?: string;
}
export interface SendGridRequest {
    method: 'POST';
    url: string;
    headers: Record<string, string>;
    body: string;
}
/** Unsigned manifest for the SendGrid plugin (sign via `signManifest`). */
export declare function sendGridPluginManifest(): PluginManifest;
/** Validate raw config against the SendGrid plugin schema. */
export declare function validateSendGridConfig(input: unknown): SendGridPluginConfig;
/** A minimal SendGrid mail client. Request-building is pure and testable offline. */
export declare class SendGridClient {
    private readonly config;
    constructor(config: SendGridPluginConfig);
    /**
     * Build the SendGrid v3 `mail/send` HTTP request for a message. Pure and
     * deterministic — no network — so the endpoint, bearer auth, and JSON body
     * shape can be verified offline.
     */
    buildMailSendRequest(msg: MailMessage): SendGridRequest;
    /** Send a message via the SendGrid API (network). Resolves with the HTTP status. */
    send(msg: MailMessage): Promise<number>;
}
/**
 * SendGrid email plugin. On load it injects a {@link SendGridClient} into each
 * request's `ctx.state[stateKey]` via middleware (requires 'middleware').
 */
export declare class SendGridPlugin extends PluginModule {
    readonly name = "street-plugin-sendgrid";
    readonly version = "1.0.0";
    private readonly raw;
    private config;
    private client;
    constructor(config: unknown);
    onInstall(): Promise<void>;
    onLoad(app: SandboxedApp): Promise<void>;
    onUnload(): Promise<void>;
    get mail(): SendGridClient;
    private _config;
}
//# sourceMappingURL=sendgrid.d.ts.map