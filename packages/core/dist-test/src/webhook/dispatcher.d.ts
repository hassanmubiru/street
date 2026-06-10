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
     *
     * `ca` is the supported mechanism for trusting endpoints served by a private
     * CA: supply the trusted certificate(s) here.
     *
     * `rejectUnauthorized` can no longer disable certificate validation. The
     * dispatcher never forwards `rejectUnauthorized: false` to the HTTPS layer,
     * so validation is always enabled regardless of this value. The field is
     * retained only for backward-compatible typing; setting it to `false` has no
     * effect. Trust private CAs via `ca` instead.
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
/**
 * Build the `node:https` request options for a webhook dispatch. Extracted from
 * `sendRequest` so the produced options object is unit-testable in isolation
 * (e.g. to assert that certificate validation is never disabled).
 *
 * Certificate validation is always left enabled: `rejectUnauthorized` is never
 * set to `false`. Endpoints served by a private CA must supply `tls.ca`.
 */
export declare function buildRequestOptions(url: string, contentLength: number, signature: string, timeoutMs: number, tls?: {
    ca?: string | Buffer | Array<string | Buffer>;
    rejectUnauthorized?: boolean;
}): import('node:https').RequestOptions;
//# sourceMappingURL=dispatcher.d.ts.map