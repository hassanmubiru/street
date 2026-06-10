import { PluginModule, type SandboxedApp } from '../sdk.js';
import { type PluginManifest } from '../host.js';
export declare const TWILIO_PLUGIN_NAME = "street-plugin-twilio";
export declare const TWILIO_PLUGIN_VERSION = "1.0.0";
export interface TwilioPluginConfig {
    accountSid: string;
    authToken: string;
    defaultFrom?: string;
    stateKey?: string;
}
export interface TwilioHttpRequest {
    method: 'POST';
    url: string;
    headers: Record<string, string>;
    body: string;
}
export interface SmsMessage {
    to: string;
    body: string;
    from?: string;
}
export declare function twilioPluginManifest(): PluginManifest;
export declare function validateTwilioConfig(input: unknown): TwilioPluginConfig;
export declare class TwilioClient {
    private readonly config;
    constructor(config: TwilioPluginConfig);
    /** Build a Twilio "create message" request (Basic auth + form body). */
    buildSendSmsRequest(msg: SmsMessage): TwilioHttpRequest;
    send(msg: SmsMessage): Promise<number>;
}
export declare class TwilioPlugin extends PluginModule {
    readonly name = "street-plugin-twilio";
    readonly version = "1.0.0";
    private readonly raw;
    private config;
    private client;
    constructor(config: unknown);
    onInstall(): Promise<void>;
    onLoad(app: SandboxedApp): Promise<void>;
    onUnload(): Promise<void>;
    get sms(): TwilioClient;
    private _config;
}
//# sourceMappingURL=twilio.d.ts.map