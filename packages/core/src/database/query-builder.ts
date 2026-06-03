// src/database/query-builder.ts
// Type-safe, dialect-aware SQL query builder.

// ── Dialect ───────────────────────────────────────────────────────────────────

/** SQL dialects supported by QueryBuilder. */
export enum SqlDialect {
  postgres = 'postgres',
  mysql    = 'mysql',
  sqlite   = 'sqlite',
}

// ── Internal AST node types ───────────────────────────────────────────────────

interface WhereClause {
  sql: string;       // fragment with '?' as placeholder slots
  params: unknown[];
}

interface JoinClause {
  type: 'INNER' | 'LEFT';
  table: string;     // may be a derived table: "(SELECT ...) AS alias"
  tableParams: unknown[]; // params for derived-table SQL (in order)
  condition: string | null; // null → no ON clause (derived-table join)
}

interface OrderByClause {
  col: string;
  dir: 'ASC' | 'DESC';
}

interface HavingClause {
  sql: string;
  params: unknown[];
}

interface FromClause {
  sql: string;
  params: unknown[]; // params from a subquery-derived FROM
}

// ── QueryBuilder ──────────────────────────────────────────────────────────────

/**
 * Fluent, compile-time-safe SQL query builder.
 *
 * @typeParam T - Shape of the primary table being queried.
 *               `keyof T & string` restricts column arguments to actual table
 *               columns at compile time.
 *
 * @example
 * ```ts
 * interface User { id: number; name: string; email: string }
 *
 * const { sql, params } = new QueryBuilder<User>()
 *   .select('id', 'name')
 *   .from('users')
 *   .where('email', '=', 'alice@example.com')
 *   .limit(10)
 *   .build();
 * // sql    → 'SELECT id, name FROM users WHERE email = $1 LIMIT 10'
 * // params → ['alice@example.com']
 * ```
 */
export class QueryBuilder<T extends object> {
  // ── AST state ─────────────────────────────────────────────────────────────

  /** Columns listed in SELECT. */
  private readonly selects:  string[]        = [];
  /** WHERE conditions (each holds a '?'-parameterised SQL fragment). */
  private readonly wheres:   WhereClause[]   = [];
  /** JOIN clauses. */
  private readonly joins:    JoinClause[]    = [];
  /** ORDER BY entries. */
  private readonly orderBys: OrderByClause[] = [];
  /** GROUP BY columns. */
  private readonly groupBys: string[]        = [];
  /** HAVING conditions. */
  private readonly havings:  HavingClause[]  = [];

  /** FROM clause (table name or derived-table expression). */
  private _from:   FromClause | null = null;
  /** LIMIT value. */
  private _limit:  number | null     = null;
  /** OFFSET value. */
  private _offset: number | null     = null;

  private readonly dialect: SqlDialect;

  constructor(dialect: SqlDialect = SqlDialect.postgres) {
    this.dialect = dialect;
  }

  // ── Fluent API ────────────────────────────────────────────────────────────

  /** Select specific columns. Column names are typed as `keyof T & string`. */
  select(...cols: (keyof T & string)[]): this {
    this.selects.push(...cols);
    return this;
  }

  /** Set the primary table (FROM clause). */
  from(table: string): this {
    this._from = { sql: table, params: [] };
    return this;
  }

  /**
   * Add a WHERE condition.
   *
   * Overloads
   *   1. `where(col, op, value)` – typed column + operator + value
   *   2. `where(rawCondition, ...values)` – raw SQL fragment with `?` slots
   */
  where(col: keyof T & string, op: string, value: unknown): this;
  where(rawCondition: string, ...values: unknown[]): this;
  where(colOrRaw: string, opOrFirstVal?: unknown, ...rest: unknown[]): this {
    if (typeof opOrFirstVal === 'string' && rest.length === 1) {
      // where(col, op, value)
      this.wheres.push({ sql: `${colOrRaw} ${opOrFirstVal} ?`, params: [rest[0]] });
    } else if (typeof opOrFirstVal === 'string' && rest.length === 0) {
      // Could be where(col, op) without value – rare but valid
      // Treat as a raw condition with no params
      this.wheres.push({ sql: `${colOrRaw} ${opOrFirstVal}`, params: [] });
    } else if (opOrFirstVal === undefined && rest.length === 0) {
      // where(rawCondition)
      this.wheres.push({ sql: colOrRaw, params: [] });
    } else {
      // where(rawCondition, value1, value2, …)
      const params: unknown[] = opOrFirstVal !== undefined
        ? [opOrFirstVal, ...rest]
        : [...rest];
      this.wheres.push({ sql: colOrRaw, params });
    }
    return this;
  }

  /** Add an INNER JOIN. */
  join(table: string, condition: string): this {
    this.joins.push({ type: 'INNER', table, tableParams: [], condition });
    return this;
  }

  /** Add a LEFT JOIN. */
  leftJoin(table: string, condition: string): this {
    this.joins.push({ type: 'LEFT', table, tableParams: [], condition });
    return this;
  }

  /** Add an ORDER BY entry. */
  orderBy(col: keyof T & string, dir: 'ASC' | 'DESC' = 'ASC'): this {
    this.orderBys.push({ col, dir });
    return this;
  }

  /** Add GROUP BY columns. */
  groupBy(...cols: (keyof T & string)[]): this {
    this.groupBys.push(...cols);
    return this;
  }

  /** Add a HAVING condition (raw SQL with `?`-parameterised values). */
  having(condition: string, ...values: unknown[]): this {
    this.havings.push({ sql: condition, params: values });
    return this;
  }

  /** Set LIMIT. */
  limit(n: number): this {
    this._limit = n;
    return this;
  }

  /** Set OFFSET. */
  offset(n: number): this {
    this._offset = n;
    return this;
  }

  /**
   * Embed the result of another `QueryBuilder` as a derived table.
   *
   * If no `from()` has been called yet the sub-query becomes the FROM source.
   * Otherwise it is appended as an INNER JOIN derived table (no ON clause).
   *
   * @param qb    - Inner query builder (built in `?`-placeholder mode so params
   *               can be re-numbered later).
   * @param alias - SQL alias for the derived table.
   */
  subquery<U extends object>(qb: QueryBuilder<U>, alias: string): this {
    // Build the inner query using mysql/sqlite '?' style so placeholders can
    // be trivially renumbered during the outer build.
    const inner = qb._buildInternal();
    const derivedSql = `(${inner.sql}) AS ${alias}`;

    if (this._from === null) {
      this._from = { sql: derivedSql, params: inner.params };
    } else {
      this.joins.push({
        type: 'INNER',
        table: derivedSql,
        tableParams: inner.params,
        condition: null,
      });
    }
    return this;
  }

  // ── Build ─────────────────────────────────────────────────────────────────

  /**
   * Render the current AST to a `{ sql, params }` pair.
   *
   * This method is **idempotent**: calling it multiple times on the same
   * (unmodified) builder always produces identical output because it only
   * reads AST state without mutating it.
   *
   * Placeholder style:
   *   - `postgres` dialect → `$1`, `$2`, …
   *   - `mysql` / `sqlite` dialects → `?`
   */
  build(): { sql: string; params: unknown[] } {
    return this._buildInternal(this.dialect);
  }

  // ── Private ───────────────────────────────────────────────────────────────

  /**
   * Internal build that accepts an explicit dialect override so that
   * sub-queries can always be rendered with '?' placeholders, making them
   * trivially composable by the outer builder.
   */
  private _buildInternal(
    dialect: SqlDialect = SqlDialect.mysql, // default '?' for composability
  ): { sql: string; params: unknown[] } {
    const allParams: unknown[] = [];
    let paramIdx = 1;

    /** Consume one value: push it to allParams and return the placeholder. */
    const consume = (v: unknown): string => {
      allParams.push(v);
      return dialect === SqlDialect.postgres ? `$${paramIdx++}` : '?';
    };

    /**
     * Replace each `?` in a SQL fragment with the appropriate placeholder
     * and push the matching param.
     */
    const expand = (sql: string, params: unknown[]): string => {
      let i = 0;
      return sql.replace(/\?/g, () => consume(params[i++]));
    };

    const parts: string[] = [];

    // SELECT
    const selectList = this.selects.length > 0 ? this.selects.join(', ') : '*';
    parts.push(`SELECT ${selectList}`);

    // FROM
    if (this._from !== null) {
      const fromSql = expand(this._from.sql, this._from.params);
      parts.push(`FROM ${fromSql}`);
    }

    // JOINs
    for (const j of this.joins) {
      const tableSql = expand(j.table, j.tableParams);
      if (j.condition !== null) {
        parts.push(`${j.type} JOIN ${tableSql} ON ${j.condition}`);
      } else {
        parts.push(`${j.type} JOIN ${tableSql}`);
      }
    }

    // WHERE
    if (this.wheres.length > 0) {
      const conditions = this.wheres.map((w) => expand(w.sql, w.params));
      parts.push(`WHERE ${conditions.join(' AND ')}`);
    }

    // GROUP BY
    if (this.groupBys.length > 0) {
      parts.push(`GROUP BY ${this.groupBys.join(', ')}`);
    }

    // HAVING
    if (this.havings.length > 0) {
      const havingParts = this.havings.map((h) => expand(h.sql, h.params));
      parts.push(`HAVING ${havingParts.join(' AND ')}`);
    }

    // ORDER BY
    if (this.orderBys.length > 0) {
      const orderParts = this.orderBys.map((o) => `${o.col} ${o.dir}`);
      parts.push(`ORDER BY ${orderParts.join(', ')}`);
    }

    // LIMIT / OFFSET
    if (this._limit !== null) {
      parts.push(`LIMIT ${this._limit}`);
    }
    if (this._offset !== null) {
      parts.push(`OFFSET ${this._offset}`);
    }

    return { sql: parts.join(' '), params: allParams };
  }
}
