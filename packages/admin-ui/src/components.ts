// Admin components for @streetjs/admin-ui. Each view consumes existing StreetJS
// backend APIs through @streetjs/react hooks / @streetjs/client — no RBAC, audit
// or tenancy logic is reimplemented on the client (RFC 0002). React is a peer dep.

import { useState, type ReactNode } from 'react';
import { useQuery, useStreetClient } from '@streetjs/react';
import { h, AsyncState, type ClassNames } from './theme.js';

interface BaseProps {
  theme?: 'light' | 'dark';
  classNames?: ClassNames;
  title?: string;
}

function shell(theme: string | undefined, className: string | undefined, children: ReactNode): ReactNode {
  return h('section', { className: className ?? 'street-admin', 'data-theme': theme }, children);
}

export interface AdminUser {
  id: string | number;
  name?: string;
  email?: string;
  roles?: string[];
  [k: string]: unknown;
}

export interface UserManagementProps extends BaseProps {
  /** Resource name for users (default 'users'). */
  resource?: string;
}

/** Paginated user table sourced from the users resource. */
export function UserManagement(props: UserManagementProps): ReactNode {
  const client = useStreetClient();
  const name = props.resource ?? 'users';
  const { data, loading, error } = useQuery<AdminUser[]>(
    () => client.resource<AdminUser>(name).list(),
    [name],
  );
  const users = Array.isArray(data) ? data : [];
  return shell(props.theme, props.classNames?.root,
    h(AsyncState, { loading, error, empty: users.length === 0, emptyText: 'No users.' },
      h('table', null,
        h('caption', null, props.title ?? 'Users'),
        h('thead', null, h('tr', null,
          h('th', { scope: 'col' }, 'Name'),
          h('th', { scope: 'col' }, 'Email'),
          h('th', { scope: 'col' }, 'Roles'),
        )),
        h('tbody', null, users.map((u) => h('tr', { key: String(u.id) },
          h('td', null, u.name ?? '—'),
          h('td', null, u.email ?? '—'),
          h('td', null, (u.roles ?? []).map((r, i) => h('span', { key: i, className: 'st-badge' }, r))),
        ))),
      ),
    ),
  );
}

export interface RoleManagerProps extends BaseProps {
  /** Resource name for users (default 'users'). */
  resource?: string;
  /** Available roles to assign. */
  roles: string[];
  /** Path template for role updates (default `/users/:id/roles`). */
  updatePath?: (userId: string | number) => string;
}

/** RBAC: assign/revoke a role on each user via the backend role endpoint. */
export function RoleManager(props: RoleManagerProps): ReactNode {
  const client = useStreetClient();
  const name = props.resource ?? 'users';
  const { data, loading, error, refetch } = useQuery<AdminUser[]>(
    () => client.resource<AdminUser>(name).list(),
    [name],
  );
  const [savingId, setSavingId] = useState<string | number | null>(null);
  const users = Array.isArray(data) ? data : [];
  const pathFor = props.updatePath ?? ((id: string | number) => `/${name}/${id}/roles`);

  const setRole = async (user: AdminUser, role: string): Promise<void> => {
    setSavingId(user.id);
    try {
      await client.request('PUT', pathFor(user.id), { body: { roles: [role] } });
      refetch();
    } finally { setSavingId(null); }
  };

  return shell(props.theme, props.classNames?.root,
    h(AsyncState, { loading, error, empty: users.length === 0, emptyText: 'No users.' },
      h('table', null,
        h('caption', null, props.title ?? 'Roles & permissions'),
        h('thead', null, h('tr', null,
          h('th', { scope: 'col' }, 'User'),
          h('th', { scope: 'col' }, 'Current roles'),
          h('th', { scope: 'col' }, 'Assign role'),
        )),
        h('tbody', null, users.map((u) => h('tr', { key: String(u.id) },
          h('td', null, u.name ?? u.email ?? String(u.id)),
          h('td', null, (u.roles ?? []).map((r, i) => h('span', { key: i, className: 'st-badge' }, r))),
          h('td', null, h('select', {
            'aria-label': `Assign role to ${u.name ?? u.email ?? u.id}`,
            disabled: savingId === u.id,
            value: (u.roles ?? [])[0] ?? '',
            onChange: (e: { target: { value: string } }) => { void setRole(u, e.target.value); },
          },
            h('option', { value: '' }, '— select —'),
            props.roles.map((r) => h('option', { key: r, value: r }, r)),
          )),
        ))),
      ),
    ),
  );
}

export interface AuditLogEntry {
  id: string | number;
  action?: string;
  actor?: string;
  target?: string;
  timestamp?: string;
  [k: string]: unknown;
}

export interface AuditLogViewerProps extends BaseProps {
  /** Path that returns an array of audit entries (default '/audit-logs'). */
  path?: string;
  /** Max rows to request (passed as `limit` query). */
  limit?: number;
}

/** Read-only audit log table sourced from the backend audit endpoint. */
export function AuditLogViewer(props: AuditLogViewerProps): ReactNode {
  const client = useStreetClient();
  const path = props.path ?? '/audit-logs';
  const limit = props.limit ?? 50;
  const { data, loading, error } = useQuery<AuditLogEntry[]>(
    () => client.request<AuditLogEntry[]>('GET', path, { query: { limit } }),
    [path, limit],
  );
  const entries = Array.isArray(data) ? data : [];
  return shell(props.theme, props.classNames?.root,
    h(AsyncState, { loading, error, empty: entries.length === 0, emptyText: 'No audit entries.' },
      h('table', null,
        h('caption', null, props.title ?? 'Audit log'),
        h('thead', null, h('tr', null,
          h('th', { scope: 'col' }, 'Time'),
          h('th', { scope: 'col' }, 'Actor'),
          h('th', { scope: 'col' }, 'Action'),
          h('th', { scope: 'col' }, 'Target'),
        )),
        h('tbody', null, entries.map((e) => h('tr', { key: String(e.id) },
          h('td', null, e.timestamp ?? '—'),
          h('td', null, e.actor ?? '—'),
          h('td', null, e.action ?? '—'),
          h('td', null, e.target ?? '—'),
        ))),
      ),
    ),
  );
}

export interface Tenant { id: string | number; name?: string; [k: string]: unknown }

export interface TenantSwitcherProps extends BaseProps {
  /** Path returning the tenants the current user can access (default '/tenants'). */
  path?: string;
  /** Currently selected tenant id. */
  value?: string | number;
  /** Called when a tenant is selected. */
  onChange?: (tenantId: string) => void;
}

/** Multi-tenancy: lists accessible tenants and emits the chosen one. */
export function TenantSwitcher(props: TenantSwitcherProps): ReactNode {
  const client = useStreetClient();
  const path = props.path ?? '/tenants';
  const { data, loading, error } = useQuery<Tenant[]>(
    () => client.request<Tenant[]>('GET', path),
    [path],
  );
  const tenants = Array.isArray(data) ? data : [];
  return shell(props.theme, props.classNames?.root,
    h(AsyncState, { loading, error, empty: tenants.length === 0, emptyText: 'No tenants available.' },
      h('label', { style: { display: 'flex', flexDirection: 'column', gap: 4 } },
        props.title ?? 'Active tenant',
        h('select', {
          'aria-label': 'Select tenant',
          value: props.value !== undefined ? String(props.value) : '',
          onChange: (e: { target: { value: string } }) => props.onChange?.(e.target.value),
        },
          h('option', { value: '' }, '— select tenant —'),
          tenants.map((t) => h('option', { key: String(t.id), value: String(t.id) }, t.name ?? String(t.id))),
        ),
      ),
    ),
  );
}
