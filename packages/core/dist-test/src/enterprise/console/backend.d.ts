import type { AuditExportInput, ClassificationPolicyInput, ConsoleBackend, CreateTenantInput, ManageSecretInput, ManageUserInput, MfaPolicyInput, RbacPolicyInput, RetentionPolicyInput, RotateKeyInput, UpdateTenantInput } from './types.js';
/**
 * In-memory ConsoleBackend. All mutations are confined to `_state`, which can be
 * captured with `snapshot()` for state-unchanged assertions.
 */
export declare class InMemoryConsoleBackend implements ConsoleBackend {
    private _state;
    /** Deep, stable JSON snapshot of all console state. */
    snapshot(): string;
    createTenant(input: CreateTenantInput): Promise<{
        id: string;
    }>;
    updateTenant(id: string, input: UpdateTenantInput): Promise<{
        id: string;
    }>;
    suspendTenant(id: string): Promise<{
        id: string;
        status: 'suspended';
    }>;
    setRbacPolicy(input: RbacPolicyInput): Promise<void>;
    setMfaPolicy(input: MfaPolicyInput): Promise<void>;
    setRetentionPolicy(input: RetentionPolicyInput): Promise<void>;
    setClassificationPolicy(input: ClassificationPolicyInput): Promise<void>;
    exportAudit(input: AuditExportInput): Promise<{
        format: string;
        recordCount: number;
    }>;
    generateComplianceReport(): Promise<{
        generatedAt: string;
        entries: unknown[];
    }>;
    securityPosture(): Promise<Record<string, unknown>>;
    manageUser(input: ManageUserInput): Promise<{
        userId: string;
        action: string;
    }>;
    rotateKey(input: RotateKeyInput): Promise<{
        keyId: string;
        rotatedAt: string;
    }>;
    manageSecret(name: string, input: ManageSecretInput): Promise<{
        name: string;
    }>;
}
/** Thrown by a backend when a referenced resource does not exist. */
export declare class ConsoleNotFoundError extends Error {
    constructor(message: string);
}
//# sourceMappingURL=backend.d.ts.map