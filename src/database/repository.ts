// src/database/repository.ts
// Generic repository and migration runner.

import { PgPool } from './pool.js';
import type { PgConnection } from './wire.js';

// ─── Repository Interface ──────────────────────────────────────────────────────

export interface IRepository<T> {
  findById(id: string): Promise<T | null>;
  findAll(limit: number, offset: number): Promise<T[]>;
  create(data: Partial<T>): Promise<T>;
  update(id: string, data: Partial<T>): Promise<T | null>;
  delete(id: string): Promise<boolean>;
  count(): Promise<number>;
}

// ─── Base repository ────────────────────────────────────────────────────────────

export abstract class StreetPostgresRepository<T extends object>
  implements IRepository<T>
{
  protected abstract readonly tableName: string;

  constructor(protected readonly pool: PgPool) {}

  protected abstract mapRow(row: Record<string, string | null>): T;

  async findById(id: string): Promise<T | null> {
    const safeId = escapeString(id);
    const result = await this.pool.query(
      `SELECT * FROM ${this.tableName} WHERE id = '${safeId}' LIMIT 1`
    );
    if (result.rows.length === 0) return null;
    return this.mapRow(result.rows[0] as Record<string, string | null>);
  }

  async findAll(limit = 20, offset = 0): Promise<T[]> {
    const safeLimit = Math.min(Math.max(1, Math.floor(limit)), 1000);
    const safeOffset = Math.max(0, Math.floor(offset));
    const result = await this.pool.query(
      `SELECT * FROM ${this.tableName} ORDER BY created_at DESC LIMIT ${safeLimit} OFFSET ${safeOffset}`
    );
    return result.rows.map((r) => this.mapRow(r as Record<string, string | null>));
  }

  async count(): Promise<number> {
    const result = await this.pool.query(`SELECT COUNT(*) AS total FROM ${this.tableName}`);
    return parseInt(result.rows[0]?.['total'] ?? '0', 10);
  }

  async create(data: Partial<T>): Promise<T> {
    const { columns, values } = buildInsert(data);
    const result = await this.pool.query(
      `INSERT INTO ${this.tableName} (${columns}) VALUES (${values}) RETURNING *`
    );
    const row = result.rows[0];
    if (!row) throw new Error('Insert returned no rows');
    return this.mapRow(row as Record<string, string | null>);
  }

  async update(id: string, data: Partial<T>): Promise<T | null> {
    if (Object.keys(data).length === 0) return this.findById(id);
    const safeId = escapeString(id);
    const setClauses = buildUpdate(data);
    const result = await this.pool.query(
      `UPDATE ${this.tableName} SET ${setClauses} WHERE id = '${safeId}' RETURNING *`
    );
    if (result.rows.length === 0) return null;
    return this.mapRow(result.rows[0] as Record<string, string | null>);
  }

  async delete(id: string): Promise<boolean> {
    const safeId = escapeString(id);
    const result = await this.pool.query(
      `DELETE FROM ${this.tableName} WHERE id = '${safeId}'`
    );
    return result.command.startsWith('DELETE') && result.rowCount > 0;
  }

  /** Execute raw SQL within a transaction */
  async withTransaction<R>(fn: (conn: PgConnection) => Promise<R>): Promise<R> {
    return this.pool.transaction(fn);
  }

  /** Stream rows with backpressure */
  streamAll(sql: string): import('./wire.js').StreetPostgresWireStream {
    return this.pool['connections']
      .find((p: { inUse: boolean }) => !p.inUse)
      ?.conn.queryStream(sql) ?? ((): never => { throw new Error('No idle connection for streaming'); })();
  }
}

// ─── ACID ledger service ────────────────────────────────────────────────────────

export class LedgerTransactionService {
  constructor(private readonly pool: PgPool) {}

  async execute<T>(
    operations: Array<(conn: PgConnection) => Promise<void>>,
    onSuccess?: () => Promise<T>
  ): Promise<T | void> {
    return this.pool.transaction(async (conn) => {
      for (const op of operations) {
        await op(conn);
      }
      if (onSuccess) return onSuccess();
    });
  }
}

// ─── SQL escaping helpers ───────────────────────────────────────────────────────

function escapeString(val: string): string {
  return val.replace(/'/g, "''").replace(/\\/g, '\\\\');
}

function escapeValue(val: unknown): string {
  if (val === null || val === undefined) return 'NULL';
  if (typeof val === 'boolean') return val ? 'TRUE' : 'FALSE';
  if (typeof val === 'number') return isFinite(val) ? String(val) : 'NULL';
  return `'${escapeString(String(val))}'`;
}

function buildInsert(data: Record<string, unknown>): { columns: string; values: string } {
  const keys = Object.keys(data).filter((k) => data[k] !== undefined);
  const columns = keys.map((k) => `"${k}"`).join(', ');
  const values = keys.map((k) => escapeValue(data[k])).join(', ');
  return { columns, values };
}

function buildUpdate(data: Record<string, unknown>): string {
  return Object.entries(data)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `"${k}" = ${escapeValue(v)}`)
    .join(', ');
}
