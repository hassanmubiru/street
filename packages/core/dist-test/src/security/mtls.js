// src/security/mtls.ts
// Mutual TLS (mTLS) support: a client-certificate-requiring HTTPS server helper,
// client-certificate validation (against a trust store + optional CN allow-list),
// and SHA-256 certificate fingerprint pinning. Built on node:tls / node:https
// and node:crypto — no third-party dependencies.
import { createServer as createHttpsServer } from 'node:https';
import { createHash, timingSafeEqual } from 'node:crypto';
import { UnauthorizedException } from '../http/exceptions.js';
// ── Fingerprints & pinning ──────────────────────────────────────────────────────
/** Compute the SHA-256 fingerprint of a DER certificate as lowercase hex (no colons). */
export function certificateFingerprint(der) {
    return createHash('sha256').update(der).digest('hex');
}
/** Normalise a fingerprint to lowercase hex without separators. */
function normalizeFp(fp) {
    return fp.replace(/:/g, '').replace(/\s/g, '').toLowerCase();
}
/** Constant-time check that a certificate's fingerprint is in the pin set. */
export function verifyCertificatePin(der, pins) {
    const actual = certificateFingerprint(der);
    const a = Buffer.from(actual, 'hex');
    for (const pin of pins) {
        const want = Buffer.from(normalizeFp(pin), 'hex');
        if (a.length === want.length && timingSafeEqual(a, want))
            return true;
    }
    return false;
}
/**
 * Validate a peer certificate against a policy. `authorized` is the TLS-layer
 * chain-of-trust result (`TLSSocket.authorized`). Pinning/CN checks are applied
 * on top. Returns a structured result rather than throwing, so it is unit-testable.
 */
export function validateClientCert(cert, authorized, policy = {}) {
    const required = policy.required ?? true;
    const present = !!cert && !!cert.raw && cert.raw.length > 0;
    if (!present) {
        return required ? { ok: false, reason: 'client_certificate_required' } : { ok: true };
    }
    const fingerprint = cert.raw ? certificateFingerprint(cert.raw) : (cert.fingerprint256 ? normalizeFp(cert.fingerprint256) : undefined);
    const subjectCN = cert.subject?.CN;
    // If pinning is configured, a matching pin is sufficient (and bypasses CA trust,
    // enabling self-signed pinned certs). Otherwise the TLS chain must be authorized.
    if (policy.allowedFingerprints && policy.allowedFingerprints.length > 0) {
        if (!cert.raw || !verifyCertificatePin(cert.raw, policy.allowedFingerprints)) {
            return { ok: false, reason: 'fingerprint_not_pinned', subjectCN, fingerprint };
        }
    }
    else if (!authorized) {
        return { ok: false, reason: 'untrusted_client_certificate', subjectCN, fingerprint };
    }
    if (policy.allowedCommonNames && policy.allowedCommonNames.length > 0) {
        if (!subjectCN || !policy.allowedCommonNames.includes(subjectCN)) {
            return { ok: false, reason: 'common_name_not_allowed', subjectCN, fingerprint };
        }
    }
    return { ok: true, subjectCN, fingerprint };
}
/**
 * Middleware enforcing a {@link ClientCertPolicy} on the request's TLS socket.
 * On success, stores `{ subjectCN, fingerprint }` in `ctx.state['clientCert']`.
 * On failure, throws {@link UnauthorizedException}. Requires the server to have
 * been created with `requestCert: true` (see {@link createMutualTlsServer}).
 */
export function clientCertMiddleware(policy = {}) {
    return async (ctx, next) => {
        const socket = ctx.req.socket;
        const authorized = typeof socket.authorized === 'boolean' ? socket.authorized : false;
        const cert = typeof socket.getPeerCertificate === 'function'
            ? socket.getPeerCertificate(true)
            : undefined;
        const result = validateClientCert(cert, authorized, policy);
        if (!result.ok) {
            throw new UnauthorizedException(`mTLS: ${result.reason}`);
        }
        ctx.state['clientCert'] = { subjectCN: result.subjectCN, fingerprint: result.fingerprint };
        await next();
    };
}
/**
 * Create an HTTPS server configured for mutual TLS. The server requests (and,
 * by default, requires CA-verified) client certificates. Pair with
 * `clientCertMiddleware` for fine-grained pinning / CN allow-listing.
 */
export function createMutualTlsServer(opts, handler) {
    const serverOpts = {
        cert: opts.cert,
        key: opts.key,
        ca: opts.ca,
        requestCert: opts.requestCert ?? true,
        rejectUnauthorized: opts.rejectUnauthorized ?? true,
        minVersion: opts.minVersion ?? 'TLSv1.2',
    };
    return createHttpsServer(serverOpts, handler);
}
/**
 * A mutable trust store for mTLS: a managed set of trusted client CAs plus
 * pinned client-certificate fingerprints. Supports rotation (adding new trust
 * material before removing old) so certificates can be rolled without downtime.
 * Validation delegates to {@link validateClientCert}.
 */
export class TrustStore {
    cas;
    pinSet;
    constructor(initial = {}) {
        this.cas = initial.ca ? [...initial.ca] : [];
        this.pinSet = new Set((initial.pins ?? []).map(normalizeFp));
    }
    /** Add a trusted client CA certificate (PEM). Idempotent for identical input. */
    addCa(ca) {
        const key = ca.toString();
        if (!this.cas.some((c) => c.toString() === key))
            this.cas.push(ca);
        return this;
    }
    /** Remove a previously-trusted CA certificate. Returns true if it was present. */
    removeCa(ca) {
        const key = ca.toString();
        const before = this.cas.length;
        this.cas = this.cas.filter((c) => c.toString() !== key);
        return this.cas.length !== before;
    }
    /** Add an allowed fingerprint pin (colons/case-insensitive). */
    addPin(fp) {
        this.pinSet.add(normalizeFp(fp));
        return this;
    }
    /** Remove a pin. Returns true if it was present. */
    removePin(fp) {
        return this.pinSet.delete(normalizeFp(fp));
    }
    /** Current trusted CA certificates. */
    caCertificates() {
        return [...this.cas];
    }
    /** Current pinned fingerprints (normalised lowercase hex). */
    pins() {
        return [...this.pinSet];
    }
    /**
     * Atomically rotate the entire trust set (e.g. when issuing from a new CA).
     * Pass the new CAs/pins; the old ones are dropped only after replacement.
     */
    rotate(next) {
        if (next.ca)
            this.cas = [...next.ca];
        if (next.pins)
            this.pinSet = new Set(next.pins.map(normalizeFp));
    }
    /** Snapshot the current material. */
    material() {
        return { ca: this.caCertificates(), pins: this.pins() };
    }
    /**
     * Validate a peer certificate against this store. CN allow-listing can be
     * layered on via {@link ClientCertPolicy}.
     */
    validate(cert, authorized, extra = {}) {
        const policy = { ...extra };
        if (this.pinSet.size > 0)
            policy.allowedFingerprints = this.pins();
        return validateClientCert(cert, authorized, policy);
    }
}
/**
 * Hot-rotate the server's TLS certificate/key (and optionally trusted CAs)
 * without restarting the listener, using Node's `tls.Server.setSecureContext`.
 * Existing connections keep their context; new handshakes use the new material.
 */
export function rotateServerCertificate(server, opts) {
    const ctx = { cert: opts.cert, key: opts.key };
    if (opts.ca !== undefined)
        ctx.ca = opts.ca;
    // setSecureContext exists on tls.Server (https.Server extends it).
    server.setSecureContext(ctx);
}
//# sourceMappingURL=mtls.js.map