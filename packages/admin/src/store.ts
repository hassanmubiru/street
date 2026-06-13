// packages/admin/src/store.ts
// Pluggable async persistence for the admin domain: users, roles, and the
// append-only audit log. The in-memory implementation is the default; a
// Postgres adapter lives in ./pg.

import type { AdminUser, Role, AuditEvent, AuditQuery } from './types.js';

/** A new audit event without its store-assigned monotonic `seq`. */
export type NewAuditEvent = Omit<AuditEvent, 'seq'>;

/** Async persistence contract for {@link AdminService}. */
export interface AdminStore {
  // Users
  insertUser(user: AdminUser): Promise<void>;
  getUser(id: string): Promise<AdminUser | undefined>;
  getUserByEmail(email: string): Promise<AdminUser | undefined>;
  listUsers(): Promise<AdminUser[]>;
  updateUser(user: AdminUser): Promise<void>;
  deleteUser(id: string): Promise<boolean>;

  // Roles
  insertRole(role: Role): Promise<void>;
  getRole(name: string): Promise<Role | undefined>;
  listRoles(): Promise<Role[]>;
  updateRole(role: Role): Promise<void>;
  deleteRole(name: string): Promise<boolean>;

  // Audit
  appendAudit(event: NewAuditEvent): Promise<void>;
  queryAudit(query: AuditQuery): Promise<AuditEvent[]>;
  countAudit(): Promise<number>;
}

// ── In-memory store (default) ──────────────────────────────────────────────────

export class InMemoryAdminStore implements AdminStore {
  private readonly users = new Map<string, AdminUser>();
  private readonly emailIndex = new Map<string, string>();
  private readonly roles = new Map<string, Role>();
  private readonly audit: AuditEvent[] = [];
  private seq = 0;

  async insertUser(user: AdminUser): Promise<void> {
    this.users.set(user.id, cloneUser(user));
    this.emailIndex.set(user.email, user.id);
  }

  async getUser(id: string): Promise<AdminUser | undefined> {
    const u = this.users.get(id);
    return u ? cloneUser(u) : undefined;
  }

  async getUserByEmail(email: string): Promise<AdminUser | undefined> {
    const id = this.emailIndex.get(email);
    return id ? this.getUser(id) : undefined;
  }

  async listUsers(): Promise<AdminUser[]> {
    return [...this.users.values()].map(cloneUser);
  }

  async updateUser(user: AdminUser): Promise<void> {
    this.users.set(user.id, cloneUser(user));
    this.emailIndex.set(user.email, user.id);
  }

  async deleteUser(id: string): Promise<boolean> {
    const u = this.users.get(id);
    if (!u) return false;
    this.users.delete(id);
    this.emailIndex.delete(u.email);
    return true;
  }

  async insertRole(role: Role): Promise<void> {
    this.roles.set(role.name, cloneRole(role));
  }

  async getRole(name: string): Promise<Role | undefined> {
    const r = this.roles.get(name);
    return r ? cloneRole(r) : undefined;
  }

  async listRoles(): Promise<Role[]> {
    return [...this.roles.values()].map(cloneRole);
  }

  async updateRole(role: Role): Promise<void> {
    this.roles.set(role.name, cloneRole(role));
  }

  async deleteRole(name: string): Promise<boolean> {
    return this.roles.delete(name);
  }

  async appendAudit(event: NewAuditEvent): Promise<void> {
    this.audit.push({ ...event, metadata: { ...event.metadata }, seq: ++this.seq });
  }

  async queryAudit(query: AuditQuery): Promise<AuditEvent[]> {
    const limit = query.limit && query.limit > 0 ? Math.floor(query.limit) : 100;
    const out: AuditEvent[] = [];
    for (let i = this.audit.length - 1; i >= 0 && out.length < limit; i--) {
      const e = this.audit[i]!;
      if (query.before !== undefined && e.seq >= query.before) continue;
      if (query.actorId && e.actorId !== query.actorId) continue;
      if (query.action && e.action !== query.action) continue;
      if (query.target && e.target !== query.target) continue;
      if (query.since !== undefined && e.createdAt < query.since) continue;
      if (query.until !== undefined && e.createdAt > query.until) continue;
      out.push({ ...e, metadata: { ...e.metadata } });
    }
    return out;
  }

  async countAudit(): Promise<number> {
    return this.audit.length;
  }
}

function cloneUser(u: AdminUser): AdminUser {
  return { ...u, roles: [...u.roles] };
}

function cloneRole(r: Role): Role {
  return { name: r.name, permissions: [...r.permissions] };
}
