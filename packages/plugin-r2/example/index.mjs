// Runnable example: register and enable the R2 plugin on a PluginHost with
// enforced signature verification, then compute deterministic SigV4 headers
// for an object request — all offline.
//
//   node example/index.mjs
//
// signedObjectHeaders is pure (same inputs → same signature) and performs no
// network call, so this demonstrates the plugin end-to-end without real
// Cloudflare R2 credentials.

import { generateKeyPairSync } from 'node:crypto';
import { PluginHost, signManifest, R2Client } from 'streetjs';
import R2Plugin, { r2PluginManifest } from '@streetjs/plugin-r2';

const { publicKey, privateKey } = generateKeyPairSync('ed25519');
const host = new PluginHost({
  grantedPermissions: ['net', 'secrets', 'middleware'],
  publicKey,
});

const config = {
  accountId: 'acct123',
  bucket: 'example-bucket',
  accessKeyId: 'R2EXAMPLE',
  secretAccessKey: 'secretExampleKey',
};

const plugin = new R2Plugin(config);
host.register(plugin, signManifest(r2PluginManifest(), privateKey));
await host.enable(plugin.name);
console.log('R2 plugin enabled:', host.has(plugin.name));

const client = new R2Client(config);
console.log('Endpoint:', client.endpoint());
const headers = client.signedObjectHeaders('GET', 'reports/q1.csv', undefined, new Date('2025-01-01T00:00:00.000Z'));
console.log('Authorization:', headers['authorization']);
