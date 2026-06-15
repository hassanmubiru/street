// Precise post-close handle inspection: after pool.close(), are any TCP sockets
// to Postgres still open? Prints the type of every remaining active handle.
import { PgPool } from 'streetjs';

function handleTypes(label) {
  const hs = process._getActiveHandles();
  const types = hs.map((h) => h?.constructor?.name ?? typeof h);
  const sockets = hs.filter((h) => (h?.constructor?.name === 'Socket'));
  console.log(`${label}: count=${hs.length} types=[${types.join(', ')}] openSockets=${sockets.length}`);
  return sockets.length;
}

handleTypes('baseline');
const pool = new PgPool({
  host: 'localhost', port: 5433, user: 'street', password: 'street_secret',
  database: 'street_test', minConnections: 2, maxConnections: 5,
  idleTimeoutMs: 5_000, acquireTimeoutMs: 5_000,
});
await pool.initialize();
await pool.query('SELECT 1');
handleTypes('after-queries');
await pool.close();
// Wait well beyond any close handshake.
await new Promise((r) => setTimeout(r, 1000));
const leaked = handleTypes('after-close+1s');
console.log(leaked === 0 ? 'RESULT: NO SOCKET LEAK' : `RESULT: ${leaked} SOCKET(S) STILL OPEN`);
process.exit(0);
