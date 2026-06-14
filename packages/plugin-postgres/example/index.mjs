// Runnable example for @streetjs/plugin-postgres.
// Prereq: PostgreSQL on 127.0.0.1:5432. Then: node example/index.mjs

import { PgPool } from 'streetjs';

const pg = new PgPool({
  host: '127.0.0.1', port: 5432,
  user: process.env.PGUSER ?? 'street',
  password: process.env.PGPASSWORD ?? 'street_secret',
  database: process.env.PGDATABASE ?? 'street_test',
});

const r = await pg.query('SELECT 1 AS ok', []);
console.log('query result:', r.rows[0]);

await pg.close();
console.log('done');
