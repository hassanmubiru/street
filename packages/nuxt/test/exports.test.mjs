import test from 'node:test';
import assert from 'node:assert/strict';
import * as nuxt from '../dist/index.js';

test('@streetjs/nuxt exports', async (t) => {
  await t.test('exposes the plugin factory + re-exported composables', () => {
    assert.equal(typeof nuxt.createStreetNuxtPlugin, 'function');
    for (const name of [
      'provideStreetClient', 'installStreetClient', 'useApi', 'useQuery',
      'useSession', 'useAuth', 'useSearch', 'useRealtime', 'useChannel',
      'useAI', 'createStreetClient',
    ]) {
      assert.equal(typeof nuxt[name], 'function', `missing composable ${name}`);
    }
  });

  await t.test('plugin factory returns a function that provides $street', () => {
    const plugin = nuxt.createStreetNuxtPlugin({ baseUrl: '/api' });
    assert.equal(typeof plugin, 'function');
    const provided = {};
    const fakeApp = { provide: (k, v) => { provided[k] = v; } };
    const result = plugin({ vueApp: fakeApp });
    // installStreetClient calls app.provide(symbolKey, client)
    assert.equal(Object.getOwnPropertySymbols(provided).length, 1);
    // the plugin also exposes the client via Nuxt's provide map
    assert.ok(result && result.provide && typeof result.provide.street === 'object');
    assert.equal(typeof result.provide.street.request, 'function');
  });
});
