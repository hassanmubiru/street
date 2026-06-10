// src/enterprise/console/backend.ts
// ConsoleBackend implementations.
//
// `InMemoryConsoleBackend` is the default, dependency-free implementation used
// for tests and local wiring. It exposes `snapshot()` so callers can assert that
// rejected requests leave all state byte-for-byte unchanged (Req 6.8).
//
// `ServiceConsoleBackend` adapts the in-memory store onto the real
// tenancy/enterprise services (tenant provisioning, audit export, compliance
// reporting, secret rotation) so the same handlers run against production state.
import { randomUUID } from 'node:crypto';
function emptyState() {
    return {
        tenants: {},
        policies: { rbac: null, mfa: null, retention: {}, classification: {} },
        users: {},
        secrets: {},
        rotatedKeys: {},
    };
}
/**
 * In-memory ConsoleBackend. All mutations are confined to `_state`, which can be
 * captured with `snapshot()` for state-unchanged assertions.
 */
export class InMemoryConsoleBackend {
    _state = emptyState();
    /** Deep, stable JSON snapshot of all console state. */
    snapshot() {
        return JSON.stringify(this._state);
    }
    async createTenant(input) {
        const id = randomUUID();
        this._state.tenants[id] = {
            id,
            name: input.name,
            plan: input.plan ?? null,
            status: 'active',
        };
        return { id };
    }
    async updateTenant(id, input) {
        const existing = this._state.tenants[id];
        if (!existing)
            throw new ConsoleNotFoundError(`tenant ${id} not found`);
        if (input.name !== undefined)
            existing.name = input.name;
        if (input.plan !== undefined)
            existing.plan = input.plan;
        if (input.status !== undefined)
            existing.status = input.status;
        return { id };
    }
    async suspendTenant(id) {
        const existing = this._state.tenants[id];
        if (!existing)
            throw new ConsoleNotFoundError(`tenant ${id} not found`);
        existing.status = 'suspended';
        return { id, status: 'suspended' };
    }
    async setRbacPolicy(input) {
        this._state.policies.rbac = { roles: input.roles.map((r) => ({ role: r.role, permissions: [...r.permissions] })) };
    }
    async setMfaPolicy(input) {
        this._state.policies.mfa = { required: input.required, ...(input.methods ? { methods: [...input.methods] } : {}) };
    }
    async setRetentionPolicy(input) {
        this._state.policies.retention[input.entity] = input.retentionDays;
    }
    async setClassificationPolicy(input) {
        this._state.policies.classification[input.field] = input.level;
    }
    async exportAudit(input) {
        // In-memory backend has no persisted audit log; report a zero-record export
        // of the requested format/window. The ServiceConsoleBackend streams real rows.
        return { format: input.format, recordCount: 0 };
    }
    async generateComplianceReport() {
        const entries = Object.entries(this._state.policies.classification).map(([field, level]) => ({
            field,
            level,
            retentionDays: this._state.policies.retention[field] ?? null,
        }));
        return { generatedAt: new Date().toISOString(), entries };
    }
    async securityPosture() {
        return {
            mfaRequired: this._state.policies.mfa?.required ?? false,
            rbacConfigured: this._state.policies.rbac !== null,
            tenantCount: Object.keys(this._state.tenants).length,
            retentionPolicies: Object.keys(this._state.policies.retention).length,
        };
    }
    async manageUser(input) {
        const existing = this._state.users[input.userId] ?? { roles: [], disabled: false };
        if (input.action === 'disable') {
            existing.disabled = true;
        }
        else {
            existing.disabled = false;
            if (input.roles)
                existing.roles = [...input.roles];
        }
        this._state.users[input.userId] = existing;
        return { userId: input.userId, action: input.action };
    }
    async rotateKey(input) {
        const rotatedAt = new Date().toISOString();
        this._state.rotatedKeys[input.keyId] = rotatedAt;
        return { keyId: input.keyId, rotatedAt };
    }
    async manageSecret(name, input) {
        this._state.secrets[name] = input.value;
        return { name };
    }
}
/** Thrown by a backend when a referenced resource does not exist. */
export class ConsoleNotFoundError extends Error {
    constructor(message) {
        super(message);
        this.name = 'ConsoleNotFoundError';
    }
}
//# sourceMappingURL=backend.js.map