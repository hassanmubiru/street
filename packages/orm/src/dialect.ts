// packages/orm/src/dialect.ts
// PostgreSQL SQL generation. Every identifier is validated by the metadata layer
// (isSafeIdentifier) before reaching here, so quoting is safe; every value is
// passed as a positional parameter ($1, $2, …) — never interpolated.

import { type EntityMeta, type RelationMeta, OrmError, isSafeIdentifier } from './metadata.js';

export interface SqlQuery { sql: string; params: unknown[]; }

/** Double-quote a pre-validated identifier. Defense-in-depth re-check. */
function q(ident: string): string {
  if (!isSafeIdentifier(ident)) throw new OrmError(`refusing to quote unsafe identifier: ${JSON.stringify(ident)}`);
  return `"${ident}"`;
}

function selectList(meta: EntityMeta): string {
  return meta.columns.map((c) => q(c.column)).join(', ');
}

/** Map a column name to its declared owner; reject unknown columns in filters. */
function columnFor(meta: EntityMeta, property: string): string {
  const col = meta.columns.find((c) => c.property === property || c.column === property);
  if (!col) throw new OrmError(`${meta.ctor.name}: unknown column "${property}" in filter`);
  return col.column;
}

/** Build `SELECT ... FROM table [WHERE ...] [LIMIT n]` with parameterized values. */
export function buildSelect(
  meta: EntityMeta,
  opts: { where?: Record<string, unknown>; limit?: number } = {},
): SqlQuery {
  const params: unknown[] = [];
  let sql = `SELECT ${selectList(meta)} FROM ${q(meta.table)}`;
  const where = opts.where ?? {};
  const keys = Object.keys(where);
  if (keys.length > 0) {
    const clauses = keys.map((k) => {
      params.push(where[k]);
      return `${q(columnFor(meta, k))} = $${params.length}`;
    });
    sql += ` WHERE ${clauses.join(' AND ')}`;
  }
  if (opts.limit !== undefined) {
    if (!Number.isInteger(opts.limit) || opts.limit < 0) throw new OrmError(`invalid limit: ${opts.limit}`);
    params.push(opts.limit);
    sql += ` LIMIT $${params.length}`;
  }
  return { sql, params };
}

/** Build a batched relation-load query: load all related rows for a set of keys. */
export function buildRelationLoad(
  rel: RelationMeta,
  ownerMeta: EntityMeta,
  targetMeta: EntityMeta,
  keys: unknown[],
  relationWhere?: Record<string, unknown>,
): SqlQuery {
  if (keys.length === 0) return { sql: '', params: [] };
  const params: unknown[] = [];
  const placeholders = (vals: unknown[]): string =>
    vals.map((v) => { params.push(v); return `$${params.length}`; }).join(', ');

  let sql: string;
  if (rel.kind === 'hasMany' || rel.kind === 'hasOne') {
    // target.foreignKey IN (owner PKs)
    sql = `SELECT ${targetMeta.columns.map((c) => q(c.column)).join(', ')} FROM ${q(targetMeta.table)}`
      + ` WHERE ${q(rel.foreignKey!)} IN (${placeholders(keys)})`;
  } else if (rel.kind === 'belongsTo') {
    // target.PK IN (owner FKs)
    sql = `SELECT ${targetMeta.columns.map((c) => q(c.column)).join(', ')} FROM ${q(targetMeta.table)}`
      + ` WHERE ${q(targetMeta.primaryKey.column)} IN (${placeholders(keys)})`;
  } else {
    // manyToMany: join the through table, returning the owner key alongside target rows.
    const tcols = targetMeta.columns.map((c) => `t.${q(c.column)}`).join(', ');
    sql = `SELECT j.${q(rel.ownerKey!)} AS __owner_key, ${tcols}`
      + ` FROM ${q(rel.through!)} j`
      + ` JOIN ${q(targetMeta.table)} t ON t.${q(targetMeta.primaryKey.column)} = j.${q(rel.targetKey!)}`
      + ` WHERE j.${q(rel.ownerKey!)} IN (${placeholders(keys)})`;
  }

  // Optional relation-level filter (AND-ed equality on target columns).
  const where = relationWhere ?? {};
  const wkeys = Object.keys(where);
  if (wkeys.length > 0) {
    const prefix = rel.kind === 'manyToMany' ? 't.' : '';
    const clauses = wkeys.map((k) => {
      params.push(where[k]);
      return `${prefix}${q(columnFor(targetMeta, k))} = $${params.length}`;
    });
    sql += ` AND ${clauses.join(' AND ')}`;
  }
  void ownerMeta;
  return { sql, params };
}
