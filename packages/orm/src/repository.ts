// packages/orm/src/repository.ts
// Relation-aware repository: base queries plus eager loading (one batched query
// per relation — N+1-safe) and on-demand lazy loading.

import { type EntityRegistry, type EntityMeta, type RelationMeta, type Ctor, OrmError } from './metadata.js';
import { buildSelect, buildRelationLoad } from './dialect.js';

/** Minimal pool contract — satisfied by streetjs `PgPool`. */
export interface QueryablePool {
  query(sql: string, params: unknown[]): Promise<{ rows: Array<Record<string, unknown>> }>;
}

type Row = Record<string, unknown>;
/** `with` spec: relation names, or a map of name → optional relation filter. */
export type WithSpec = string[] | Record<string, { where?: Record<string, unknown> }>;

export interface FindOptions {
  where?: Record<string, unknown>;
  limit?: number;
  with?: WithSpec;
}

function normalizeWith(spec: WithSpec | undefined): Map<string, { where?: Record<string, unknown> }> {
  const m = new Map<string, { where?: Record<string, unknown> }>();
  if (!spec) return m;
  if (Array.isArray(spec)) { for (const name of spec) m.set(name, {}); return m; }
  for (const [name, opts] of Object.entries(spec)) m.set(name, opts ?? {});
  return m;
}

export class Repository<T extends object> {
  constructor(
    private readonly registry: EntityRegistry,
    private readonly meta: EntityMeta,
    private readonly pool: QueryablePool,
  ) {}

  /** Map a raw DB row (keyed by column) to an entity-shaped object (keyed by property). */
  private mapRow(meta: EntityMeta, raw: Row): Row {
    const out: Row = {};
    for (const c of meta.columns) out[c.property] = raw[c.column];
    return out;
  }

  async find(opts: FindOptions = {}): Promise<T[]> {
    const { sql, params } = buildSelect(this.meta, { ...(opts.where ? { where: opts.where } : {}), ...(opts.limit !== undefined ? { limit: opts.limit } : {}) });
    const { rows } = await this.pool.query(sql, params);
    const mapped = rows.map((r) => this.mapRow(this.meta, r));
    const withMap = normalizeWith(opts.with);
    for (const [relName, relOpts] of withMap) {
      await this.attachRelation(mapped, rows, relName, relOpts.where);
    }
    return mapped as T[];
  }

  async findOne(opts: FindOptions = {}): Promise<T | null> {
    const rows = await this.find({ ...opts, limit: opts.limit ?? 1 });
    return rows[0] ?? null;
  }

  private relation(name: string): RelationMeta {
    const rel = this.meta.relations.find((r) => r.property === name);
    if (!rel) throw new OrmError(`${this.meta.ctor.name} has no relation "${name}"`);
    return rel;
  }

  /** Eager-load one relation for a set of parent rows in a single batched query. */
  private async attachRelation(
    parents: Row[], rawParents: Row[], relName: string, relWhere?: Record<string, unknown>,
  ): Promise<void> {
    if (parents.length === 0) return;
    const rel = this.relation(relName);
    const targetMeta = this.registry.metaOf(rel.target);

    if (rel.kind === 'hasMany' || rel.kind === 'hasOne') {
      const pkCol = this.meta.primaryKey.column;
      const keys = [...new Set(rawParents.map((r) => r[pkCol]))];
      const { sql, params } = buildRelationLoad(rel, this.meta, targetMeta, keys, relWhere);
      const { rows } = await this.pool.query(sql, params);
      const byKey = new Map<unknown, Row[]>();
      for (const raw of rows) {
        const k = raw[rel.foreignKey!];
        (byKey.get(k) ?? byKey.set(k, []).get(k)!).push(this.mapRow(targetMeta, raw));
      }
      parents.forEach((p, i) => {
        const k = rawParents[i]![pkCol];
        const children = byKey.get(k) ?? [];
        p[relName] = rel.kind === 'hasMany' ? children : (children[0] ?? null);
      });
    } else if (rel.kind === 'belongsTo') {
      const fkCol = rel.foreignKey!;
      const keys = [...new Set(rawParents.map((r) => r[fkCol]))];
      const { sql, params } = buildRelationLoad(rel, this.meta, targetMeta, keys, relWhere);
      const { rows } = await this.pool.query(sql, params);
      const byPk = new Map<unknown, Row>();
      for (const raw of rows) byPk.set(raw[targetMeta.primaryKey.column], this.mapRow(targetMeta, raw));
      parents.forEach((p, i) => { p[relName] = byPk.get(rawParents[i]![fkCol]) ?? null; });
    } else {
      // manyToMany
      const pkCol = this.meta.primaryKey.column;
      const keys = [...new Set(rawParents.map((r) => r[pkCol]))];
      const { sql, params } = buildRelationLoad(rel, this.meta, targetMeta, keys, relWhere);
      const { rows } = await this.pool.query(sql, params);
      const byOwner = new Map<unknown, Row[]>();
      for (const raw of rows) {
        const owner = raw['__owner_key'];
        (byOwner.get(owner) ?? byOwner.set(owner, []).get(owner)!).push(this.mapRow(targetMeta, raw));
      }
      parents.forEach((p, i) => { p[relName] = byOwner.get(rawParents[i]![pkCol]) ?? []; });
    }
  }

  /** Lazy-load a single relation for one already-loaded entity row. */
  async loadRelation<R = unknown>(entity: T, relName: string): Promise<R> {
    const rel = this.relation(relName);
    const targetMeta = this.registry.metaOf(rel.target);
    const e = entity as Row;
    if (rel.kind === 'belongsTo') {
      const fkVal = e[this.propFor(rel.foreignKey!)];
      const { sql, params } = buildRelationLoad(rel, this.meta, targetMeta, [fkVal]);
      const { rows } = await this.pool.query(sql, params);
      const v = rows[0] ? this.mapRow(targetMeta, rows[0]) : null;
      e[relName] = v;
      return v as R;
    }
    const pkVal = e[this.meta.primaryKey.property];
    const { sql, params } = buildRelationLoad(rel, this.meta, targetMeta, [pkVal]);
    const { rows } = await this.pool.query(sql, params);
    const mapped = rows.map((r) => this.mapRow(targetMeta, r));
    const v = rel.kind === 'hasOne' ? (mapped[0] ?? null) : mapped;
    e[relName] = v;
    return v as R;
  }

  /** Resolve a column name to its property name (for reading FK values off entities). */
  private propFor(column: string): string {
    return this.meta.columns.find((c) => c.column === column)?.property ?? column;
  }
}

export type { Ctor };
