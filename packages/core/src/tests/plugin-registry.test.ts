// tests/plugin-registry.test.ts
// Verifies the local plugin registry: publish/fetch/list/search/verify, signed
// publication, tamper + wrong-key rejection, JSON round-trip with tamper guard,
// and end-to-end install through the registry into a PluginHost. Offline only.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import {
  PluginHost, signManifest,
  PluginSignatureError, PluginError, PluginStateError,
  type PluginManifest,
} from '../platform/plugins/host.js';
import { LocalPluginRegistry, installFromRegistry } from '../platform/plugins/local-registry.js';
import { S3Plugin, s3PluginManifest, S3_PLUGIN_NAME } from '../platform/plugins/official/s3.js';

const s3Config = {
  bucket: 'b', region: 'us-east-1', accessKeyId: 'AKIA', secretAccessKey: 'sk',
};

function ed25519() {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  return { privateKey, publicPem: publicKey.export({ type: 'spki', format: 'pem' }).toString() };
}

describe('plugin registry — publish & discovery', () => {
  it('publishes a signed plugin and exposes it via list/fetch/search', () => {
    const { privateKey, publicPem } = ed25519();
    const reg = new LocalPluginRegistry();
    const signed = signManifest(s3PluginManifest(), privateKey);

    const rec = reg.publish(signed, publicPem, { author: 'street', homepage: 'https://example.test' });
    assert.equal(rec.publicKey, publicPem);
    assert.equal(rec.metadata['author'], 'street');

    assert.deepEqual(reg.list(), [`${S3_PLUGIN_NAME}@1.0.0`]);
    const fetched = reg.fetch(S3_PLUGIN_NAME, '1.0.0');
    assert.equal(fetched.manifest.name, S3_PLUGIN_NAME);
    assert.equal(fetched.publicKey, publicPem);

    const hits = reg.search('object-storage');
    assert.equal(hits.length, 1);
    assert.equal(hits[0]!.manifest.name, S3_PLUGIN_NAME);
    assert.equal(reg.search('nonexistent').length, 0);
  });

  it('verify() returns true for a correctly published plugin', () => {
    const { privateKey, publicPem } = ed25519();
    const reg = new LocalPluginRegistry();
    reg.publish(signManifest(s3PluginManifest(), privateKey), publicPem);
    assert.equal(reg.verify(S3_PLUGIN_NAME, '1.0.0'), true);
    assert.equal(reg.verify('ghost', '9.9.9'), false);
  });

  it('rejects duplicate publication', () => {
    const { privateKey, publicPem } = ed25519();
    const reg = new LocalPluginRegistry();
    const signed = signManifest(s3PluginManifest(), privateKey);
    reg.publish(signed, publicPem);
    assert.throws(() => reg.publish(signed, publicPem), PluginStateError);
  });
});

describe('plugin registry — signature enforcement', () => {
  it('refuses to publish an unsigned manifest', () => {
    const { publicPem } = ed25519();
    const reg = new LocalPluginRegistry();
    const unsigned: PluginManifest = s3PluginManifest(); // no checksum/signature
    assert.throws(() => reg.publish(unsigned, publicPem), /not signed/);
  });

  it('rejects a tampered plugin (manifest changed after signing)', () => {
    const { privateKey, publicPem } = ed25519();
    const reg = new LocalPluginRegistry();
    const signed = signManifest(s3PluginManifest(), privateKey);
    const tampered = { ...signed, capabilities: [...(signed.capabilities ?? []), 'backdoor'] };
    assert.throws(() => reg.publish(tampered, publicPem), PluginSignatureError);
  });

  it('rejects a valid signature verified against the wrong public key', () => {
    const signer = ed25519();
    const other = ed25519();
    const reg = new LocalPluginRegistry();
    const signed = signManifest(s3PluginManifest(), signer.privateKey);
    assert.throws(() => reg.publish(signed, other.publicPem), PluginSignatureError);
  });

  it('rejects an invalid public key', () => {
    const { privateKey } = ed25519();
    const reg = new LocalPluginRegistry();
    const signed = signManifest(s3PluginManifest(), privateKey);
    assert.throws(() => reg.publish(signed, 'not-a-key'), /invalid public key/);
  });
});

describe('plugin registry — JSON round-trip with tamper guard', () => {
  it('serializes and rehydrates, but refuses tampered serialized records', () => {
    const { privateKey, publicPem } = ed25519();
    const reg = new LocalPluginRegistry();
    reg.publish(signManifest(s3PluginManifest(), privateKey), publicPem);

    const json = reg.toJSON();
    const restored = LocalPluginRegistry.fromJSON(json);
    assert.deepEqual(restored.list(), [`${S3_PLUGIN_NAME}@1.0.0`]);

    // Tamper the serialized record → fromJSON must reject it.
    const tampered = JSON.parse(JSON.stringify(json)) as typeof json;
    tampered[0]!.manifest.capabilities = ['evil'];
    assert.throws(() => LocalPluginRegistry.fromJSON(tampered), PluginSignatureError);
  });
});

describe('plugin registry — install through registry into PluginHost', () => {
  it('publishes then installs+enables a signed plugin end-to-end', async () => {
    const { privateKey, publicPem } = ed25519();
    const reg = new LocalPluginRegistry();
    reg.publish(signManifest(s3PluginManifest(), privateKey), publicPem);

    const host = new PluginHost({ grantedPermissions: '*' });
    const rec = await installFromRegistry(reg, host, new S3Plugin(s3Config));
    assert.equal(rec.manifest.name, S3_PLUGIN_NAME);
    assert.equal(host.state(S3_PLUGIN_NAME), 'enabled');
    assert.equal(host.middlewaresOf(S3_PLUGIN_NAME).length, 1);
  });

  it('install fails for a plugin not in the registry', async () => {
    const reg = new LocalPluginRegistry();
    const host = new PluginHost({ grantedPermissions: '*' });
    await assert.rejects(() => installFromRegistry(reg, host, new S3Plugin(s3Config)), PluginError);
  });
});
