// Postgres connection-lifecycle + transaction + cleanup probe against the live
// street_test_pg container (host :5433). Uses the native driver from streetjs.
import { PgPool } from 'streetjs';

const pool = new PgPool({
  host: process.env.PG_HOST ?? 'localhost',
  port: Number(process.env.PG_PORT ?? 5433),
  user: process.env.PG_USER ?? 'street',
  password: process.env.PG_PASSWORD ?? 'street_secret',
  database: process.env.PG_DATABASE ?? 'street_test',
  minConnections: 2, maxConnections: 5,
  idleTimeoutMs: 5_000, acquireTimeoutMs: 5_000,
});

const handlesBefore = process._getActiveHandles().length;
await pool.initialize();

// 1. Basic query (connection lifecycle: acquire → query → release internally)
const ping = await pool.query('SELECT 1 AS one');
console.log('query:', Number(ping.rows[0].one) === 1 ? 'OK' : 'FAIL');

await pool.query('CREATE TABLE IF NOT EXISTS _audit_probe (id serial primary key, v int)');
await pool.query('TRUNCATE _audit_probe');

// 2. Transaction commit
await pool.transaction(async (conn) => {
  await conn.query('INSERT INTO _audit_probe (v) VALUES ($1)', [42]);
});
const committed = await pool.query('SELECT v FROM _audit_probe');
console.log('transaction-commit:', Number(committed.rows[0]?.v) === 42 ? 'OK' : 'FAIL');

// 3. Rollback safety (throwing inside transaction must auto-rollback)
let rolledBack = false;
try {
  await pool.transaction(async (conn) => {
    await conn.query('INSERT INTO _audit_probe (v) VALUES (99)');
    throw new Error('intentional');
  });
} catch { rolledBack = true; }
const afterRollback = await pool.query('SELECT COUNT(*)::int AS n FROM _audit_probe');
console.log('rollback-safety:', rolledBack && Number(afterRollback.rows[0].n) === 1 ? 'OK' : 'FAIL');

// 4. Cleanup + leak check
await pool.query('DROP TABLE _audit_probe');
await pool.close();
await new Promise((r) => setTimeout(r, 200));
const handlesAfter = process._getActiveHandles().length;
console.log(`handles before=${handlesBefore} after=${handlesAfter}`,
  handlesAfter <= handlesBefore ? 'NO-LEAK' : 'POSSIBLE-LEAK');
