export type CspDirectives = Record<string, string[] | true>;
/**
 * Build a Content-Security-Policy header value from a directive map.
 * - `['self']` → `default-src 'self'`
 * - `true`     → a valueless directive (e.g. `upgrade-insecure-requests`)
 * Tokens that are CSP keywords (`self`, `none`, `unsafe-inline`, nonces/hashes)
 * are quoted automatically; hosts/schemes are emitted verbatim.
 */
export declare function buildCsp(directives: CspDirectives): string;
/** Hardened default CSP: same-origin only, no inline scripts, framing denied. */
export declare const DEFAULT_CSP: CspDirectives;
export interface SecurityHeadersOptions {
    /** CSP directive map; defaults to {@link DEFAULT_CSP}. Pass `false` to omit CSP. */
    csp?: CspDirectives | false;
    /** HSTS max-age in seconds (default 63072000 = 2y). `0` omits HSTS. */
    hstsMaxAge?: number;
    /** `X-Frame-Options` value (default `DENY`). */
    frameOptions?: 'DENY' | 'SAMEORIGIN';
    /** `Referrer-Policy` (default `strict-origin-when-cross-origin`). */
    referrerPolicy?: string;
    /** `Permissions-Policy` (default disables geolocation/mic/camera). */
    permissionsPolicy?: string;
}
interface HeaderSink {
    setHeader(name: string, value: string): void;
}
/**
 * Compute the security headers for the given options. Returned as a plain map
 * so it can be unit-tested and applied to any sink.
 */
export declare function computeSecurityHeaders(opts?: SecurityHeadersOptions): Record<string, string>;
/**
 * Configurable security-headers middleware factory. Backward-compatible default
 * output matches the always-on `securityHeaders` middleware; pass options to
 * customise CSP/HSTS/frame policy per application.
 */
export declare function securityHeadersMiddleware(opts?: SecurityHeadersOptions): (ctx: HeaderSink, next: () => Promise<void>) => Promise<void>;
export {};
//# sourceMappingURL=headers.d.ts.map