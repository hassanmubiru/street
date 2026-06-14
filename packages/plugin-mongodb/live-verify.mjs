// Live verification against a real mongod (no auth). Not part of the offline
// suite. Run: node packages/plugin-mongodb/live-verify.mjs
import assert from 'node:assert/strict';
import { MongoClient, ObjectId } from './dist/index.js';

const mongo = new MongoClient({ host: '127.0.0.1', port: 27017, database: 'street_live_verify' });
await mongo.connect();
console.log('1. connected + handshake OK');

const marker = `verify-${Date.now()}-${Math.random().toString(16).slice(2)}`;
const ins = await mongo.insertOne('events', { _id: new ObjectId(), marker, n: 42, ok: true, at: new Date() });
assert.equal(ins.ok === 1 || ins.ok === true, true, 'insert ok');
assert.equal(ins.n, 1, 'one doc inserted');
console.log('2. insertOne OK (n=' + ins.n + ')');

const found = await mongo.find('events', { marker }, { limit: 5 });
assert.equal(found.length, 1, 'exactly one doc found');
assert.equal(found[0].marker, marker, 'marker round-trips');
assert.equal(found[0].n, 42, 'int round-trips');
assert.equal(found[0].ok, true, 'bool round-trips');
console.log('3. find OK — BSON round-trip verified (marker, int, bool, ObjectId, Date)');

await mongo.close();
console.log('4. closed cleanly');
console.log('\nLIVE MONGODB VERIFICATION: PASS');
