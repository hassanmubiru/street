// src/tenancy/tenant-scoped.ts
// TenantScopedRepository — base class that injects tenant_id into all SQL operations.

import type { TenantContextData } from './context.js';

type GenericPool = {
  query(sql: string, params?: unknown[]): Promise<{
    rows: Record<string, unknown>[];
    rowCount: number;
    command: string;
  }>;
};

/**
 * Base class for tenant-scoped repositories.
 * All SELECT, INSERT, UPDATE, DELETE operations automatically include
 * the `tenant_id` constraint derived from the current tenant context.
 */
export class TenantScopedRepository<T extends Record<string, unknown>> {
  protected readonly tableName: string;
  private _tenant: TenantContextData | null = null;

  constructor(protected readonly pool: GenericPool, tableName: string) {
    this.tableName = tableName;
  }

  /** Set the current tenant context. Called by middleware or @TenantScoped decorator. */
  setTenant(tenant: TenantContextData): void {
    this._tenant = tenant;
  }

  /** Get the current tenant ID; throws if no tenant context has been set. */
  protected get tenantId(): string {
    if (!this._tenant) {
      throw new Error(
        `TenantScopedRepository<${this.tableName}>: no tenant context set. ` +
          'Call setTenant(ctx.state["tenant"]) before using this repository.',
      );
    }
    return this._tenant.id;
  }

  /** Find a single record by primary key, scoped to the current tenant. */
  async findById(id: string): Promise<T | null> {
    const result = await this.pool.query(
      `SELECT * FROM ${this.tableName} WHERE id = $1 AND tenant_id = $2 LIMIT 1`,
      [id, this.tenantId],
    );
    return (result.rows[0] as T) ?? null;
  }

  /** Find all records belonging to the current tenant. */
  async findAll(where?: Partial<T>): Promise<T[]> {
    if (!where || Object.keys(where).length === 0) {
      const result = await this.pool.query(
        `SELECT * FROM ${this.tableName} WHERE tenant_id = $1`,
        [this.tenantId],
      );
      return result.rows as T[];
    }

    const keys = Object.keys(where);
    const conditions = keys.map((k, i) => `${k} = $${i + 2}`).join(' AND ');
    const values = keys.map((k) => where[k]);

    const result = await this.pool.query(
      `SELECT * FROM ${this.tableName} WHERE tenant_id = $1 AND ${conditions}`,
      [this.tenantId, ...values],
    );
    return result.rows as T[];
  }

  /** Insert a new record, automatically setting tenant_id. */
  async create(data: Omit<T, 'tenant_id' | 'id'> & { id?: string }): Promise<T> {
    const withTenant = { ...data, tenant_id: this.tenantId };
    const keys = Object.keys(withTenant);
    const placeholders = keys.map((_, i) => `$${i + 1}`).join(', ');
    const values = keys.map((k) => (withTenant as Record<string, unknown>)[k]);

    const result = await this.pool.query(
      `INSERT INTO ${this.tableName} (${keys.join(', ')}) VALUES (${placeholders}) RETURNING *`,
      values,
    );
    return result.rows[0] as T;
  }

  /** Update a record by ID, scoped to the current tenant. */
  async update(id: string, data: Partial<T>): Promise<T | null> {
    const keys = Object.keys(data);
    if (keys.length === 0) return this.findById(id);

    const setClause = keys.map((k, i) => `${k} = $${i + 3}`).join(', ');
    const values = keys.map((k) => data[k]);

    const result = await this.pool.query(
      `UPDATE ${this.tableName} SET ${setClause} WHERE id = $1 AND tenant_id = $2 RETURNING *`,
      [id, this.tenantId, ...values],
    );
    return (result.rows[0] as T) ?? null;
  }

  /** Delete a record by ID, scoped to the current tenant. Returns true if deleted. */
  async delete(id: string): Promise<boolean> {
    const result = await this.pool.query(
      `DELETE FROM ${this.tableName} WHERE id = $1 AND tenant_id = $2`,
      [id, this.tenantId],
    );
    return result.rowCount > 0;
  }
}

// ── @TenantScoped decorator ───────────────────────────────────────────────────

/**
 * Class decorator that marks a repository as tenant-scoped.
 * Works with classes that extend `TenantScopedRepository`.
 * Stores metadata under `street:tenantScoped` for runtime inspection.
 */
export function TenantScoped(): ClassDecorator {
  return (target) => {
    Reflect.defineMetadata('street:tenantScoped', true, target);
  };
}
