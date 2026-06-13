// packages/admin/src/types.ts
// Shared admin domain types.

export type UserStatus = 'active' | 'suspended';

export interface AdminUser {
  id: string;
  email: string;
  status: UserStatus;
  roles: string[];
  createdAt: number;
}

export interface Role {
  name: string;
  permissions: string[];
}

export interface AuditEvent {
  id: string;
  actorId: string;
  action: string;
  target: string | null;
  metadata: Record<string, unknown>;
  createdAt: number;
  /** Monotonic ordering key. */
  seq: number;
}

export interface AuditQuery {
  actorId?: string;
  action?: string;
  target?: string;
  since?: number;
  until?: number;
  limit?: number;
  /** Only events with seq < before (older), for pagination. */
  before?: number;
}

/** Permission match: `granted` may use `*` wildcards (`users:*`, `*`, `*:read`). */
export function permissionMatches(granted: string, requested: string): boolean {
  if (granted === '*' || granted === requested) return true;
  const g = granted.split(':');
  const r = requested.split(':');
  if (g.length !== r.length) return false;
  return g.every((part, i) => part === '*' || part === r[i]);
}
