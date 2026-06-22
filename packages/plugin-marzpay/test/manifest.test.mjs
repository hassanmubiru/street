// Unit tests for the MarzPay plugin skeleton.
// Pure/offline — no network. Run: npm test -w packages/plugin-marzpay

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  marzPayPluginManifest, MARZPAY_PLUGIN_NAME, MARZPAY_PLUGIN_VERSION,
} from '../dist/index.js';

describe('manifest', () => {
  it('declares name, version, capabilities, permissions', () => {
    const m = marzPayPluginManifest();
    assert.equal(m.name, MARZPAY_PLUGIN_NAME);
    assert.equal(m.name, 'street-plugin-marzpay');
    assert.equal(m.version, MARZPAY_PLUGIN_VERSION);
    assert.deepEqual(m.capabilities, ['payments', 'marzpay']);
    assert.deepEqual(m.permissions, ['net', 'secrets', 'middleware']);
  });
});
