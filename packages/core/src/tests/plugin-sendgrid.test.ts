// tests/plugin-sendgrid.test.ts
// Verifies the official SendGrid plugin end-to-end on the PluginHost: config
// schema, signed-manifest installation, permission gating, lifecycle + sandbox
// injection, and deterministic SendGrid v3 request building. Offline only.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import {
  PluginHost, signManifest, PluginPermissionError, PluginError,
} from '../platform/plugins/host.js';
import {
  SendGridPlugin, SendGridClient, sendGridPluginManifest, validateSendGridConfig,
  SENDGRID_PLUGIN_NAME,
} from '../platform/plugins/official/sendgrid.js';
import type { StreetContext } from '../core/context.js';

const cfg = { apiKey: 'SG.test-key', defaultFrom: 'noreply@example.com' };

describe('SendGrid plugin — config schema', () => {
  it('accepts valid config and rejects missing/invalid fields', () => {
    assert.equal(validateSendGridConfig(cfg).apiKey, 'SG.test-key');
    assert.throws(() => validateSendGridConfig({}), /apiKey.*required/);
    assert.throws(() => validateSendGridConfig({ apiKey: '' }), /apiKey.*required/);
    assert.throws(() => validateSendGridConfig({ apiKey: 'k', defaultFrom: 5 }), /defaultFrom.*must be a string/);
    assert.throws(() => validateSendGridConfig(null), /must be an object/);
  });
});

describe('SendGrid plugin — deterministic request building', () => {
  const client = new SendGridClient(cfg);
  it('builds a SendGrid v3 mail/send request with bearer auth and JSON body', () => {
    const r = client.buildMailSendRequest({ to: 'user@example.com', subject: 'Hi', text: 'hello' });
    assert.equal(r.method, 'POST');
    assert.equal(r.url, 'https://api.sendgrid.com/v3/mail/send');
    assert.equal(r.headers['authorization'], 'Bearer SG.test-key');
    assert.equal(r.headers['content-type'], 'application/json');
    const body = JSON.parse(r.body);
    assert.equal(body.personalizations[0].to[0].email, 'user@example.com');
    assert.equal(body.from.email, 'noreply@example.com');
    assert.equal(body.subject, 'Hi');
    assert.deepEqual(body.content, [{ type: 'text/plain', value: 'hello' }]);
  });
  it('supports html + per-message from override', () => {
    const r = client.buildMailSendRequest({ to: 'a@b.com', subject: 's', html: '<p>x</p>', from: 'team@example.com' });
    const body = JSON.parse(r.body);
    assert.equal(body.from.email, 'team@example.com');
    assert.deepEqual(body.content, [{ type: 'text/html', value: '<p>x</p>' }]);
  });
  it('rejects messages without from, to, or content', () => {
    const noFrom = new SendGridClient({ apiKey: 'k' });
    assert.throws(() => noFrom.buildMailSendRequest({ to: 'a@b.com', subject: 's', text: 'x' }), /no "from"/);
    assert.throws(() => client.buildMailSendRequest({ to: '', subject: 's', text: 'x' }), /"to" is required/);
    assert.throws(() => client.buildMailSendRequest({ to: 'a@b.com', subject: 's' }), /"text" or "html"/);
  });
});

describe('SendGrid plugin — install through PluginHost', () => {
  it('registers (signed), enforces permissions, enables, and injects the client', async () => {
    const { publicKey, privateKey } = generateKeyPairSync('ed25519');
    const host = new PluginHost({ grantedPermissions: ['net', 'secrets', 'middleware'], publicKey });
    host.register(new SendGridPlugin(cfg), signManifest(sendGridPluginManifest(), privateKey));
    assert.deepEqual(host.findByCapability('email'), [SENDGRID_PLUGIN_NAME]);

    const plugin = host.list().includes(SENDGRID_PLUGIN_NAME);
    assert.ok(plugin);
    await host.enable(SENDGRID_PLUGIN_NAME);
    assert.equal(host.state(SENDGRID_PLUGIN_NAME), 'enabled');

    const mw = host.middlewaresOf(SENDGRID_PLUGIN_NAME)[0]!;
    const ctx = { state: {} as Record<string, unknown> } as unknown as StreetContext;
    await mw(ctx, async () => undefined);
    assert.ok((ctx.state as Record<string, unknown>)['mail'] instanceof SendGridClient);
  });

  it('cannot enable without granted permissions', async () => {
    const host = new PluginHost({ grantedPermissions: ['net'] }); // missing secrets+middleware
    host.register(new SendGridPlugin(cfg), sendGridPluginManifest());
    await assert.rejects(() => host.enable(SENDGRID_PLUGIN_NAME), PluginPermissionError);
  });

  it('fails enable on invalid config and throws when accessing client before load', async () => {
    const host = new PluginHost({ grantedPermissions: '*' });
    host.register(new SendGridPlugin({}), sendGridPluginManifest());
    await assert.rejects(() => host.enable(SENDGRID_PLUGIN_NAME), /apiKey.*required/);
    assert.throws(() => new SendGridPlugin(cfg).mail, PluginError);
  });
});
