// Unit tests for the MarzPay plugin lifecycle: registration and client
// injection. Pure/offline — no network. Run: npm test -w packages/plugin-marzpay
//
// Task 8.2 — assert exactly one retrievable MarzPayClient on a valid config and
// NO client on an invalid config (bad apiKey/secretKey/environment).
//
// Validates: Requirements 2.2, 2.3, 2.4, 2.7
//
// Harness: mirrors the PayPal/Stripe lifecycle. `onLoad(app)` calls
// `app.use(middleware)`; we capture the registered middleware with a fake app
// and run it against a fake ctx `{ state: {} }` to observe the injected client,
// exactly as the SandboxedApp middleware pipeline would.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { PluginError } from 'streetjs';

import { MarzPayPlugin, MarzPayPluginModule, MarzPayClient } from '../dist/index.js';

const VALID_CONFIG = { apiKey: 'ak-live', secretKey: 'sk-live' };

/**
 * Minimal fake SandboxedApp capturing every middleware registered via `use`.
 * `onLoad` registers exactly one middleware assigning the client to
 * `ctx.state[stateKey]`.
 */
function fakeApp() {
  const middlewares = [];
  return {
    middlewares,
    use(mw) {
      middlewares.push(mw);
    },
  };
}

/** Run a captured middleware against a fresh fake ctx and report next() calls. */
async function runMiddleware(mw, ctx = { state: {} }) {
  let nextCalls = 0;
  await mw(ctx, async () => {
    nextCalls += 1;
  });
  return { ctx, nextCalls };
}

// ── Valid config: registration succeeds + exactly one client injected ────────
describe('MarzPayPlugin lifecycle: valid config', () => {
  it('the factory returns a MarzPayPluginModule', () => {
    const plugin = MarzPayPlugin(VALID_CONFIG);
    assert.ok(plugin instanceof MarzPayPluginModule);
    assert.equal(plugin.name, 'street-plugin-marzpay');
  });

  it('onInstall + onLoad register exactly one middleware that injects one MarzPayClient at ctx.state["marzpay"]', async () => {
    const plugin = MarzPayPlugin(VALID_CONFIG);
    const app = fakeApp();

    await plugin.onInstall();
    await plugin.onLoad(app);

    // Exactly one middleware is registered by onLoad.
    assert.equal(app.middlewares.length, 1, 'onLoad should register exactly one middleware');

    // Running it injects a single MarzPayClient under the default state key and
    // continues the pipeline (next() called once).
    const { ctx, nextCalls } = await runMiddleware(app.middlewares[0]);
    const injected = ctx.state['marzpay'];
    assert.ok(injected instanceof MarzPayClient, 'ctx.state["marzpay"] must be a MarzPayClient');
    assert.equal(nextCalls, 1, 'middleware must call next() exactly once');

    // The injected client is exactly the one exposed by the `payments` accessor
    // (single construction — same instance everywhere).
    assert.equal(injected, plugin.payments, 'injected client must be the same instance as plugin.payments');
  });

  it('injects the SAME single client instance across repeated middleware runs (single construction)', async () => {
    const plugin = MarzPayPlugin(VALID_CONFIG);
    const app = fakeApp();
    await plugin.onInstall();
    await plugin.onLoad(app);

    const first = (await runMiddleware(app.middlewares[0])).ctx.state['marzpay'];
    const second = (await runMiddleware(app.middlewares[0])).ctx.state['marzpay'];
    assert.equal(first, second, 'the same client instance must be injected on every request');
    assert.ok(first instanceof MarzPayClient);
  });

  it('routes the client to a custom stateKey when configured', async () => {
    const plugin = MarzPayPlugin({ ...VALID_CONFIG, stateKey: 'payments' });
    const app = fakeApp();
    await plugin.onInstall();
    await plugin.onLoad(app);

    const { ctx } = await runMiddleware(app.middlewares[0]);
    assert.ok(ctx.state['payments'] instanceof MarzPayClient, 'client must be injected at the custom stateKey');
    assert.equal(ctx.state['marzpay'], undefined, 'default key must be empty when a custom stateKey is set');
    assert.equal(ctx.state['payments'], plugin.payments);
  });

  it('onUnload releases the client reference', async () => {
    const plugin = MarzPayPlugin(VALID_CONFIG);
    const app = fakeApp();
    await plugin.onInstall();
    await plugin.onLoad(app);
    assert.ok(plugin.payments instanceof MarzPayClient);

    await plugin.onUnload(app);
    assert.throws(() => plugin.payments, (err) => err instanceof PluginError);
  });
});

// ── Invalid config: onInstall throws naming the field + NO client injected ───
describe('MarzPayPlugin lifecycle: invalid config injects no client', () => {
  // Each case: onInstall must throw a PluginError naming the offending field,
  // onLoad must register no middleware, and the payments accessor must throw.
  const cases = [
    // (a) apiKey — missing / empty / whitespace-only
    { label: 'missing apiKey', config: { secretKey: 'sk' }, field: 'apiKey' },
    { label: 'empty apiKey', config: { apiKey: '', secretKey: 'sk' }, field: 'apiKey' },
    { label: 'whitespace apiKey', config: { apiKey: '   ', secretKey: 'sk' }, field: 'apiKey' },
    // (b) secretKey — missing / empty / whitespace-only
    { label: 'missing secretKey', config: { apiKey: 'ak' }, field: 'secretKey' },
    { label: 'empty secretKey', config: { apiKey: 'ak', secretKey: '' }, field: 'secretKey' },
    { label: 'whitespace secretKey', config: { apiKey: 'ak', secretKey: '\t\n' }, field: 'secretKey' },
    // (c) invalid environment value
    { label: 'invalid environment', config: { apiKey: 'ak', secretKey: 'sk', environment: 'prod' }, field: 'environment' },
  ];

  for (const { label, config, field } of cases) {
    it(`${label}: onInstall throws naming "${field}" and no client is injected`, async () => {
      const plugin = MarzPayPlugin(config);
      const app = fakeApp();

      // onInstall validates BEFORE registration → throws naming the field.
      await assert.rejects(
        () => plugin.onInstall(),
        (err) => err instanceof PluginError && err.message.includes(`"${field}"`),
        `onInstall must throw a PluginError naming "${field}"`,
      );

      // Registration never completed → no middleware was registered.
      assert.equal(app.middlewares.length, 0, 'no middleware should be registered on a bad config');

      // No client is retrievable: the payments accessor throws.
      assert.throws(
        () => plugin.payments,
        (err) => err instanceof PluginError,
        'payments accessor must throw when no client was injected',
      );
    });
  }
});
