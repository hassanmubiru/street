// TLS config-surface validation (Outstanding Action #15). Pure/offline.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { validateMongoConfig } from '../dist/index.js';

const base = { host: 'db.example.com', database: 'app' };

describe('MongoDB TLS config', () => {
  it('defaults to plain TCP (tls undefined) — backward compatible', () => {
    assert.equal(validateMongoConfig(base).tls, undefined);
  });
  it('accepts the TLS surface', () => {
    const c = validateMongoConfig({ ...base, tls: true, tlsRejectUnauthorized: false, tlsServerName: 'db.internal', tlsCa: '-----BEGIN CERTIFICATE-----' });
    assert.equal(c.tls, true);
    assert.equal(c.tlsRejectUnauthorized, false);
    assert.equal(c.tlsServerName, 'db.internal');
    assert.ok(c.tlsCa.startsWith('-----BEGIN'));
  });
  it('rejects wrong types', () => {
    assert.throws(() => validateMongoConfig({ ...base, tls: 'yes' }), /"tls" must be a boolean/);
    assert.throws(() => validateMongoConfig({ ...base, tlsRejectUnauthorized: 1 }), /"tlsRejectUnauthorized" must be a boolean/);
    assert.throws(() => validateMongoConfig({ ...base, tlsServerName: 5 }), /"tlsServerName" must be a string/);
    assert.throws(() => validateMongoConfig({ ...base, tlsCa: {} }), /"tlsCa" must be a string/);
  });
});
