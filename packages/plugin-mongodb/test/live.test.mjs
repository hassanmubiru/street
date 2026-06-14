// Live integration test for @streetjs/plugin-mongodb against a real mongod.
//
// Skips automatically when MONGO_HOST is unset (so the offline suite stays
// hermetic); runs in CI where the mongodb-integration workflow provides a
// mongod service container. Exercises the full wire path: connect + (optional)
// SCRAM-SHA-256 auth, insertOne, and find with BSON round-trip.
//
// Env: MONGO_HOST, MONGO_PORT, MONGO_DB, MONGO_USER, MONGO_PASS, MONGO_AUTHSOURCE

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { MongoClient, ObjectId } from '../dist/index.js';

const HOST = process.env.MONGO_HOST;

describe('plugin-mongodb — live integration', () => {
  it('connects, authenticates, inserts, and finds against a real mongod', async (t) => {
    if (!HOST) {
      t.skip('MONGO_HOST not set — live mongod not available (set by CI)');
      return;
    }

    const client = new MongoClient({
      host: HOST,
      port: process.env.MONGO_PORT ? Number(process.env.MONGO_PORT) : 27017,
      database: process.env.MONGO_DB ?? 'street_live',
      ...(process.env.MONGO_USER
        ? {
            user: process.env.MONGO_USER,
            password: process.env.MONGO_PASS ?? '',
            authSource: process.env.MONGO_AUTHSOURCE ?? 'admin',
          }
        : {}),
    });

    await client.connect(); // handshake (+ SCRAM-SHA-256 when creds are present)

    const marker = `live-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const ins = await client.insertOne('events', {
      _id: new ObjectId(),
      marker,
      n: 42,
      ok: true,
      at: new Date(),
    });
    assert.equal(ins.ok === 1 || ins.ok === true, true, 'insert acknowledged');
    assert.equal(ins.n, 1, 'exactly one document inserted');

    const found = await client.find('events', { marker }, { limit: 5 });
    assert.equal(found.length, 1, 'exactly one document found');
    assert.equal(found[0].marker, marker, 'string round-trips');
    assert.equal(found[0].n, 42, 'int32 round-trips');
    assert.equal(found[0].ok, true, 'boolean round-trips');

    await client.close();
  });
});
