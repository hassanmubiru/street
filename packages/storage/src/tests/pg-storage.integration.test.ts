// pg-storage.integration.test.ts
// Integration tests for the Postgres storage provider against a live database.
// Gated on PG env vars (skips DB-free).

import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { PgPool } from 'streetjs';
import { StorageService, PgStorageProvider, STORAGE_MIGRATION_SQL, UrlSigner } from '../index.js';

const HAS_PG = Boolean(process.env['PG_HOST'] && process.env['PG_DATABASE']);

describe('PgStorageProvider (live Postgres)', { skip: !HAS_PG ? 'PG_* env not set' : false }, () => {
  let pool: PgPool;
  let s: StorageService;

  before(async () => {
    pool = new PgPool({
      host: process.env['PG_HOST']!,
      port: Number(process.env['PG_PORT'] ?? 5432),
      user: process.env['PG_USER'] ?? 'street',
      password: process.env['PG_PASSWORD'] ?? '',
      database: process.env['PG_DATABASE']!,
      maxConnections: 4,
      acquireTimeoutMs: 5_000,
    });
    await pool.query(STORAGE_MIGRATION_SQL);
    s = new StorageService({
      provider: new PgStorageProvider(pool, { bucket: 'it_storage' }),
      signer: new UrlSigner('a-very-secret-signing-key'),
    });
  });

  beforeEach(async () => {
    await pool.query(`DELETE FROM street_storage_objects WHERE bucket = 'it_storage'`);
  });

  after(async () => {
    await pool.query('DROP TABLE IF EXISTS street_storage_objects');
    await pool.close();
  });

  it('round-trips binary bytes exactly through base64 storage', async () => {
    const bytes = Buffer.from([0, 1, 2, 250, 255, 13, 10, 0, 200]);
    await s.upload('bin/blob.dat', bytes, { contentType: 'application/octet-stream', metadata: { owner: 'u1' } });
    const got = await s.download('bin/blob.dat');
    assert.ok(got);
    assert.ok(got!.data.equals(bytes), 'bytes must round-trip identically');
    assert.equal(got!.contentType, 'application/octet-stream');
    assert.deepEqual(got!.metadata, { owner: 'u1' });
    assert.equal(got!.size, bytes.byteLength);
  });

  it('exists, list by prefix, and delete', async () => {
    await s.upload('img/a.png', Buffer.from('a'), { contentType: 'image/png' });
    await s.upload('img/b.png', Buffer.from('bb'), { contentType: 'image/png' });
    await s.upload('docs/c.txt', Buffer.from('ccc'));
    assert.equal(await s.exists('img/a.png'), true);
    assert.deepEqual((await s.list('img/')).map((o) => o.key), ['img/a.png', 'img/b.png']);
    assert.equal(await s.remove('img/a.png'), true);
    assert.equal(await s.exists('img/a.png'), false);
    assert.equal(await s.remove('img/a.png'), false);
  });

  it('upsert overwrites an existing object', async () => {
    await s.upload('k', Buffer.from('v1'), { contentType: 'text/plain' });
    await s.upload('k', Buffer.from('v2-longer'), { contentType: 'text/plain' });
    const got = await s.download('k');
    assert.equal(got!.data.toString(), 'v2-longer');
    assert.equal((await s.list()).length, 1);
  });

  it('enforces service-layer limits and signed URLs over the PG provider', async () => {
    const limited = new StorageService({ provider: new PgStorageProvider(pool, { bucket: 'it_storage' }), maxBytes: 4 });
    await assert.rejects(() => limited.upload('big', Buffer.from('toolong')), /exceeds limit/);
    const url = s.signedUrl('img/b.png', { expiresInSeconds: 60 });
    assert.equal(s.verifySignedUrl(url), true);
  });
});
