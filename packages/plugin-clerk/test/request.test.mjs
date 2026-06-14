// Unit tests for the Clerk plugin's request builders + config validation.
// Pure/offline — no network. Run: npm test -w packages/plugin-clerk

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  validateClerkConfig, buildGetUserRequest, buildListUsersRequest,
  clerkPluginManifest, CLERK_PLUGIN_NAME,
} from '../dist/index.js';

const cfg = { secretKey: 'sk_test_123' };

describe('validateClerkConfig', () => {
  it('accepts a minimal config', () => {
    assert.equal(validateClerkConfig(cfg).secretKey, 'sk_test_123');
  });
  it('rejects a missing secretKey', () => {
    assert.throws(() => validateClerkConfig({}), /"secretKey" is required/);
  });
  it('rejects a non-https baseUrl', () => {
    assert.throws(() => validateClerkConfig({ ...cfg, baseUrl: 'http://x' }), /"baseUrl" must be an https URL/);
  });
});

describe('buildGetUserRequest', () => {
  it('targets /users/:id with bearer auth', () => {
    const req = buildGetUserRequest(cfg, 'user_abc');
    assert.equal(req.method, 'GET');
    assert.match(req.url, /\/v1\/users\/user_abc$/);
    assert.equal(req.headers.authorization, 'Bearer sk_test_123');
  });
  it('rejects an invalid user id', () => {
    assert.throws(() => buildGetUserRequest(cfg, 'a/b'), /invalid userId/);
  });
});

describe('buildListUsersRequest', () => {
  it('builds a bare list request', () => {
    const req = buildListUsersRequest(cfg);
    assert.match(req.url, /\/v1\/users$/);
  });
  it('appends pagination params', () => {
    const req = buildListUsersRequest(cfg, { limit: 10, offset: 20 });
    assert.match(req.url, /\/users\?limit=10&offset=20$/);
  });
});

describe('manifest', () => {
  it('declares name, capabilities, permissions', () => {
    const m = clerkPluginManifest();
    assert.equal(m.name, CLERK_PLUGIN_NAME);
    assert.deepEqual(m.capabilities, ['auth', 'identity', 'clerk']);
    assert.deepEqual(m.permissions, ['net', 'secrets', 'middleware']);
  });
});
