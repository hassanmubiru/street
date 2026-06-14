// packages/core/src/tests/official-key.test.ts
// Verifies the embedded official plugin-signing public key is a well-formed
// Ed25519 SPKI key usable for manifest verification. Offline.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { KeyObject } from 'node:crypto';

import { OFFICIAL_PLUGIN_PUBLIC_KEY_PEM, officialPluginPublicKey } from '../platform/plugins/official-key.js';

describe('official plugin-signing key', () => {
  it('is a PEM SPKI public key block', () => {
    assert.match(OFFICIAL_PLUGIN_PUBLIC_KEY_PEM, /^-----BEGIN PUBLIC KEY-----/);
    assert.match(OFFICIAL_PLUGIN_PUBLIC_KEY_PEM, /-----END PUBLIC KEY-----\s*$/);
  });

  it('parses into an Ed25519 public KeyObject', () => {
    const key = officialPluginPublicKey();
    assert.ok(key instanceof KeyObject);
    assert.equal(key.type, 'public');
    assert.equal(key.asymmetricKeyType, 'ed25519');
  });
});
