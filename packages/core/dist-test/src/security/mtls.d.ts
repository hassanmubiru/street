import { type Server as HttpsServer } from 'node:https';
import type { IncomingMessage, ServerResponse } from 'node:http';
/** Compute the SHA-256 fingerprint of a DER certificate as lowercase hex (no colons). */
export declare function certificateFingerprint(der: Buffer): string;
/** Constant-time check that a certificate's fingerprint is in the pin set. */
export declare function verifyCertificatePin(der: Buffer, pins: string[]): boolean;
export interface ClientCertPolicy {
    /** Require a client certificate; reject if absent. Default true. */
    required?: boolean;
    /** Allowed certificate SHA-256 fingerprints (pinning). When set, the cert must match one. */
    allowedFingerprints?: string[];
    /** Allowed subject Common Names. When set, the cert subject CN must be in this list. */
    allowedCommonNames?: string[];
}
export interface ClientCertResult {
    ok: boolean;
    reason?: string;
    subjectCN?: string;
    fingerprint?: string;
}
/** A structural view of the peer certificate (subset of node:tls PeerCertificate). */
export interface PeerCertLike {
    subject?: {
        CN?: string;
    };
    fingerprint256?: string;
    raw?: Buffer;
}
/**
 * Validate a peer certificate against a policy. `authorized` is the TLS-layer
 * chain-of-trust result (`TLSSocket.authorized`). Pinning/CN checks are applied
 * on top. Returns a structured result rather than throwing, so it is unit-testable.
 */
export declare function validateClientCert(cert: PeerCertLike | undefined, authorized: boolean, policy?: ClientCertPolicy): ClientCertResult;
interface MtlsContext {
    req: IncomingMessage;
    state: Record<string, unknown>;
}
/**
 * Middleware enforcing a {@link ClientCertPolicy} on the request's TLS socket.
 * On success, stores `{ subjectCN, fingerprint }` in `ctx.state['clientCert']`.
 * On failure, throws {@link UnauthorizedException}. Requires the server to have
 * been created with `requestCert: true` (see {@link createMutualTlsServer}).
 */
export declare function clientCertMiddleware(policy?: ClientCertPolicy): (ctx: MtlsContext, next: () => Promise<void>) => Promise<void>;
export interface MutualTlsServerOptions {
    /** Server certificate (PEM). */
    cert: string | Buffer;
    /** Server private key (PEM). */
    key: string | Buffer;
    /** Trusted CA certificate(s) used to verify client certs. */
    ca: string | Buffer | Array<string | Buffer>;
    /** Request a client certificate. Default true. */
    requestCert?: boolean;
    /**
     * Reject TLS connections whose client cert fails CA verification at the TLS
     * layer. Set false to defer authorization to `clientCertMiddleware`
     * (e.g. when using fingerprint pinning with self-signed client certs).
     */
    rejectUnauthorized?: boolean;
    /** Minimum TLS version. Default 'TLSv1.2'. */
    minVersion?: 'TLSv1.2' | 'TLSv1.3';
}
/**
 * Create an HTTPS server configured for mutual TLS. The server requests (and,
 * by default, requires CA-verified) client certificates. Pair with
 * `clientCertMiddleware` for fine-grained pinning / CN allow-listing.
 */
export declare function createMutualTlsServer(opts: MutualTlsServerOptions, handler: (req: IncomingMessage, res: ServerResponse) => void): HttpsServer;
/** Material describing the currently-trusted server identity + client CAs/pins. */
export interface TrustMaterial {
    /** Trusted CA certificate(s) used to verify client certs. */
    ca: Array<string | Buffer>;
    /** Allowed client-certificate SHA-256 fingerprints (pins). */
    pins: string[];
}
/**
 * A mutable trust store for mTLS: a managed set of trusted client CAs plus
 * pinned client-certificate fingerprints. Supports rotation (adding new trust
 * material before removing old) so certificates can be rolled without downtime.
 * Validation delegates to {@link validateClientCert}.
 */
export declare class TrustStore {
    private cas;
    private pinSet;
    constructor(initial?: {
        ca?: Array<string | Buffer>;
        pins?: string[];
    });
    /** Add a trusted client CA certificate (PEM). Idempotent for identical input. */
    addCa(ca: string | Buffer): this;
    /** Remove a previously-trusted CA certificate. Returns true if it was present. */
    removeCa(ca: string | Buffer): boolean;
    /** Add an allowed fingerprint pin (colons/case-insensitive). */
    addPin(fp: string): this;
    /** Remove a pin. Returns true if it was present. */
    removePin(fp: string): boolean;
    /** Current trusted CA certificates. */
    caCertificates(): Array<string | Buffer>;
    /** Current pinned fingerprints (normalised lowercase hex). */
    pins(): string[];
    /**
     * Atomically rotate the entire trust set (e.g. when issuing from a new CA).
     * Pass the new CAs/pins; the old ones are dropped only after replacement.
     */
    rotate(next: {
        ca?: Array<string | Buffer>;
        pins?: string[];
    }): void;
    /** Snapshot the current material. */
    material(): TrustMaterial;
    /**
     * Validate a peer certificate against this store. CN allow-listing can be
     * layered on via {@link ClientCertPolicy}.
     */
    validate(cert: PeerCertLike | undefined, authorized: boolean, extra?: Omit<ClientCertPolicy, 'allowedFingerprints'>): ClientCertResult;
}
export interface RotateCertificateOptions {
    cert: string | Buffer;
    key: string | Buffer;
    ca?: string | Buffer | Array<string | Buffer>;
}
/**
 * Hot-rotate the server's TLS certificate/key (and optionally trusted CAs)
 * without restarting the listener, using Node's `tls.Server.setSecureContext`.
 * Existing connections keep their context; new handshakes use the new material.
 */
export declare function rotateServerCertificate(server: HttpsServer, opts: RotateCertificateOptions): void;
export {};
//# sourceMappingURL=mtls.d.ts.map