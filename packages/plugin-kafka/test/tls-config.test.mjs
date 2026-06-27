// TLS config-surface validation (Outstanding Action #15). Pure/offline.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { validateKafkaConfig, toClientOptions } from '../dist/index.js';

const base = { brokers: ['broker.example.com:9093'] };

describe('Kafka TLS config (SSL/SASL_SSL listener)', () => {
  it('defaults to plain TCP (tls undefined) — backward compatible', () => {
    assert.equal(validateKafkaConfig(base).tls, undefined);
  });
  it('accepts the TLS surface and threads it into client options', () => {
    const cfg = validateKafkaConfig({ ...base, tls: true, tlsRejectUnauthorized: false, tlsServerName: 'broker.internal', tlsCa: '-----BEGIN CERTIFICATE-----' });
    assert.equal(cfg.tls, true);
    const opts = toClientOptions(cfg);
    assert.equal(opts.tls, true);
    assert.equal(opts.tlsRejectUnauthorized, false);
    assert.equal(opts.tlsServerName, 'broker.internal');
    assert.ok(opts.tlsCa.startsWith('-----BEGIN'));
  });
  it('rejects wrong types', () => {
    assert.throws(() => validateKafkaConfig({ ...base, tls: 'yes' }), /"tls" must be a boolean/);
    assert.throws(() => validateKafkaConfig({ ...base, tlsRejectUnauthorized: 1 }), /"tlsRejectUnauthorized" must be a boolean/);
    assert.throws(() => validateKafkaConfig({ ...base, tlsServerName: 5 }), /"tlsServerName" must be a string/);
    assert.throws(() => validateKafkaConfig({ ...base, tlsCa: {} }), /"tlsCa" must be a string/);
  });
});
