export interface WebhookPayload {
    event: string;
    data: unknown;
    ts: number;
    id: string;
}
export interface WebhookTarget {
    url: string;
    secret: string;
    timeoutMs?: number;
    maxRetries?: number;
    /**
     * Optional TLS settings for endpoints served by a private/corporate CA.
     * `ca` supplies trusted certificate(s); `rejectUnauthorized` should remain
     * true in production (default).
     */
    tls?: {
        ca?: string | Buffer | Array<string | Buffer>;
        rejectUnauthorized?: boolean;
    };
}
export interface WebhookJob {
    target: WebhookTarget;
    payload: WebhookPayload;
    attempt: number;
}
export declare class WebhookDispatcher {
    private readonly queue;
    private running;
    private processing;
    private stopped;
    private readonly allowedHosts;
    private readonly _warnedUrls;
    private readonly _warnClearTimer;
    /**
     * @param allowedHosts - Optional set of hostnames/IPs that bypass the SSRF
     * blocklist. Use ONLY in test environments to allow localhost HTTPS servers.
     * Never pass user-controlled values here.
     */
    constructor(allowedHosts?: string[]);
    enqueue(target: WebhookTarget, event: string, data: unknown): boolean;
    private _drain;
    private _dispatch;
    stop(): void;
}
//# sourceMappingURL=dispatcher.d.ts.map