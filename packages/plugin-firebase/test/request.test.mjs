// Unit tests for the Firebase plugin's request builders + config validation.
// Pure/offline — no network. Run: npm test -w packages/plugin-firebase

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  validateFirebaseConfig, buildSignUpRequest, buildSignInRequest, buildLookupRequest,
  firebasePluginManifest, FIREBASE_PLUGIN_NAME,
} from '../dist/index.js';

const cfg = { apiKey: 'AIzaTEST' };

describe('validateFirebaseConfig', () => {
  it('accepts a minimal config', () => {
    assert.equal(validateFirebaseConfig(cfg).apiKey, 'AIzaTEST');
  });
  it('rejects a missing apiKey', () => {
    assert.throws(() => validateFirebaseConfig({}), /"apiKey" is required/);
  });
});

describe('buildSignUpRequest', () => {
  it('targets :signUp with the api key as a query param and returnSecureToken', () => {
    const req = buildSignUpRequest(cfg, 'user@example.com', 'secret123');
    assert.equal(req.method, 'POST');
    assert.match(req.url, /accounts:signUp\?key=AIzaTEST$/);
    const body = JSON.parse(req.body);
    assert.equal(body.email, 'user@example.com');
    assert.equal(body.returnSecureToken, true);
  });
  it('rejects an invalid email', () => {
    assert.throws(() => buildSignUpRequest(cfg, 'not-an-email', 'secret123'), /invalid email/);
  });
  it('rejects a short password', () => {
    assert.throws(() => buildSignUpRequest(cfg, 'a@b.co', '123'), /at least 6 characters/);
  });
});

describe('buildSignInRequest', () => {
  it('targets :signInWithPassword', () => {
    const req = buildSignInRequest(cfg, 'a@b.co', 'pw');
    assert.match(req.url, /accounts:signInWithPassword\?key=AIzaTEST$/);
  });
});

describe('buildLookupRequest', () => {
  it('targets :lookup with the idToken', () => {
    const req = buildLookupRequest(cfg, 'id-token-xyz');
    assert.match(req.url, /accounts:lookup\?key=AIzaTEST$/);
    assert.equal(JSON.parse(req.body).idToken, 'id-token-xyz');
  });
  it('rejects an empty idToken', () => {
    assert.throws(() => buildLookupRequest(cfg, ''), /"idToken" is required/);
  });
});

describe('manifest', () => {
  it('declares name, capabilities, permissions', () => {
    const m = firebasePluginManifest();
    assert.equal(m.name, FIREBASE_PLUGIN_NAME);
    assert.deepEqual(m.capabilities, ['auth', 'identity', 'firebase']);
    assert.deepEqual(m.permissions, ['net', 'secrets', 'middleware']);
  });
});
