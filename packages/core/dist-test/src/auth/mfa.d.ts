/** Encode a buffer as RFC 4648 base32 (no padding) — used for otpauth secrets. */
export declare function base32Encode(buf: Buffer): string;
/** Decode an RFC 4648 base32 string (padding/whitespace tolerated). */
export declare function base32Decode(input: string): Buffer;
export type TotpAlgorithm = 'SHA1' | 'SHA256' | 'SHA512';
export interface TotpOptions {
    digits?: number;
    periodSec?: number;
    algorithm?: TotpAlgorithm;
}
/** RFC 4226 HOTP: HMAC-based one-time password for an explicit counter. */
export declare function hotp(secret: Buffer, counter: bigint, opts?: TotpOptions): string;
/** RFC 6238 TOTP for a given time (ms since epoch; defaults to now). */
export declare function totp(secret: Buffer, opts?: TotpOptions, nowMs?: number): string;
/**
 * Verify a user-supplied TOTP code, accepting codes within ±`window` periods to
 * tolerate clock skew. Comparison is constant-time. Returns true on match.
 */
export declare function verifyTotp(secret: Buffer, code: string, opts?: TotpOptions & {
    window?: number;
}, nowMs?: number): boolean;
export declare const MFA_MIGRATION_SQL = "CREATE TABLE IF NOT EXISTS street_mfa (\n  user_id TEXT PRIMARY KEY,\n  secret_b32 TEXT NOT NULL,\n  enabled BOOLEAN NOT NULL DEFAULT FALSE,\n  recovery_hashes JSONB NOT NULL DEFAULT '[]',\n  created_at TIMESTAMPTZ DEFAULT NOW(),\n  confirmed_at TIMESTAMPTZ\n);";
export interface MfaPool {
    query(sql: string, params?: unknown[]): Promise<{
        rows: Record<string, unknown>[];
        rowCount: number;
    }>;
}
export interface EnrollmentResult {
    secret: string;
    otpauthUrl: string;
    recoveryCodes: string[];
}
/** Generate `count` human-friendly recovery codes (e.g. `a1b2-c3d4-e5`). */
export declare function generateRecoveryCodes(count?: number): string[];
/**
 * MFA enrollment + verification backed by a SQL table. Secrets are stored as
 * base32; recovery codes are stored only as SHA-256 hashes and are single-use.
 */
export declare class MfaService {
    private readonly pool;
    private readonly opts;
    constructor(pool: MfaPool, opts?: {
        issuer?: string;
        totp?: TotpOptions;
    });
    /** Begin enrollment: generate a secret + recovery codes, store (disabled). */
    beginEnrollment(userId: string, accountName: string): Promise<EnrollmentResult>;
    /** Confirm enrollment by verifying the first code; enables MFA on success. */
    confirmEnrollment(userId: string, code: string): Promise<boolean>;
    /** Whether MFA is enabled for a user. */
    isEnabled(userId: string): Promise<boolean>;
    /** Verify a TOTP code for an enabled user. */
    verify(userId: string, code: string): Promise<boolean>;
    /**
     * Consume a single-use recovery code. Returns true and removes the code's hash
     * on success; false if the code is unknown/already used.
     */
    useRecoveryCode(userId: string, code: string): Promise<boolean>;
    /** Disable and remove MFA for a user. */
    disable(userId: string): Promise<void>;
    private _row;
}
interface MfaContext {
    user: {
        id?: string;
    } | null;
    state: Record<string, unknown>;
    json(data: unknown, status?: number): void;
}
export interface MfaGuardOptions {
    /**
     * Key in `ctx.state` that marks the current session as having completed MFA
     * for this request (set it after a successful step-up verification). Default
     * `'mfaVerified'`.
     */
    verifiedStateKey?: string;
}
/**
 * Step-up MFA guard. For an authenticated user who has MFA enabled, the request
 * is allowed only when the session is marked MFA-verified; otherwise it responds
 * `403 { error: 'mfa_required' }` so the client can prompt for a code. Users
 * without MFA enabled, and unauthenticated requests, pass through unchanged
 * (pair with an auth guard upstream).
 */
export declare function mfaGuard(service: MfaService, opts?: MfaGuardOptions): (ctx: MfaContext, next: () => Promise<void>) => Promise<void>;
/**
 * Verify a step-up challenge: accepts a TOTP code or a single-use recovery code.
 * On success, marks `ctx.state[verifiedStateKey] = true`. Returns the outcome so
 * callers can issue an MFA-elevated session token.
 */
export declare function verifyMfaStepUp(service: MfaService, userId: string, code: string, ctx?: MfaContext, opts?: MfaGuardOptions): Promise<{
    ok: boolean;
    method?: 'totp' | 'recovery_code';
}>;
export {};
//# sourceMappingURL=mfa.d.ts.map