// Throwaway forensic repro for F-1: queryStream intermittent empty result.
// Opens ONE fresh connection (no preceding error test) and runs queryStream
// in a tight loop, counting how often it yields an empty/short result.
import { PgConnection } from './dist/src/database/wire.js';

const conn = await PgConnection.connect({
  host: '127.0.0.1', port: 55432, user: 'street', password: 'street_secret', database: 'street_test', connectTimeoutMs: 10000,
});

let empty = 0, short = 0, ok = 0;
const N = 300;
for (let i = 0; i < N; i++) {
  const stream = conn.queryStream('SELECT generate_series(1,3) AS n');
  const rows = [];
  await new Promise((resolve, reject) => {
    stream.on('data', (r) => rows.push(r['n']));
    stream.on('end', resolve);
    stream.on('error', reject);
  });
  if (rows.length === 0) empty++;
  else if (rows.length !== 3) short++;
  else ok++;
}
console.log(`fresh-connection loop: N=${N} ok=${ok} empty=${empty} short=${short}`);
await conn.close();
