export declare const WEBAUTHN_MIGRATION_SQL: string;
/** Decode a subset of CBOR used in WebAuthn attestation/assertion objects. */
export declare function decodeCbor(buf: Buffer): unknown;
export interface WebAuthnConfig {
    rpName: string;
    rpId: string;
    origin: string;
    challengeExpiryMs?: number;
}
export interface PublicKeyCredentialCreationOptionsJSON {
    rp: {
        name: string;
        id: string;
    };
    user: {
        id: string;
        name: string;
        displayName: string;
    };
    challenge: string;
    pubKeyCredParams: Array<{
        type: string;
        alg: number;
    }>;
    timeout: number;
    attestation: string;
}
export interface PublicKeyCredentialRequestOptionsJSON {
    challenge: string;
    timeout: number;
    rpId: string;
    allowCredentials: Array<{
        type: string;
        id: string;
    }>;
    userVerification: string;
}
export interface RegistrationResponseJSON {
    id: string;
    rawId: string;
    response: {
        clientDataJSON: string;
        attestationObject: string;
    };
    type: string;
}
export interface AuthenticationResponseJSON {
    id: string;
    rawId: string;
    response: {
        clientDataJSON: string;
        authenticatorData: string;
        signature: string;
        userHandle?: string;
    };
    type: string;
}
export interface WebAuthnSession {
    getChallenge(userId: string): Promise<{
        challenge: string;
        expiresAt: number;
    } | null>;
    setChallenge(userId: string, challenge: string, expiresAt: number): Promise<void>;
    clearChallenge(userId: string): Promise<void>;
}
export interface WebAuthnPool {
    query(sql: string, params?: unknown[]): Promise<{
        rows: Record<string, string | null>[];
        rowCount: number;
        command: string;
    }>;
}
export declare class WebAuthnService {
    private readonly _config;
    private readonly _pool;
    private readonly _session;
    constructor(config: WebAuthnConfig, pool: WebAuthnPool, session: WebAuthnSession);
    beginRegistration(userId: string): Promise<PublicKeyCredentialCreationOptionsJSON>;
    finishRegistration(userId: string, credential: RegistrationResponseJSON): Promise<{
        credentialId: string;
    }>;
    beginAuthentication(userId: string): Promise<PublicKeyCredentialRequestOptionsJSON>;
    finishAuthentication(userId: string, assertion: AuthenticationResponseJSON): Promise<void>;
}
//# sourceMappingURL=webauthn.d.ts.map