// Build step: produce manifest.signed.json from manifest.json (Ed25519).
// STREET_PLUGIN_SIGNING_KEY (PKCS#8 PEM) is used when set; otherwise the build
// PRESERVES the committed (official) signed manifest instead of re-signing with
// an ephemeral key — so a plain `npm run build` never clobbers tracked, officially
// signed artifacts. An ephemeral dev keypair is only generated to BOOTSTRAP when
// no signed manifest exists yet. Pure Node — no third-party dependencies.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { generateKeyPairSync, createPrivateKey, createPublicKey } from 'node:crypto';
import { signManifest, verifyManifest } from 'streetjs';

const pkgRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const signedPath = join(pkgRoot, 'manifest.signed.json');
const pubPath = join(pkgRoot, 'manifest.pub');
const manifest = JSON.parse(readFileSync(join(pkgRoot, 'manifest.json'), 'utf8'));

const envKey = process.env.STREET_PLUGIN_SIGNING_KEY;
const hasKey = !!(envKey && envKey.trim() !== '');

// Keyless build with an existing signed manifest: do NOT overwrite the committed
// (official) artifacts. Validate them and exit. Set STREET_PLUGIN_SIGNING_KEY to
// (re)sign — that path is taken by the publish workflow.
if (!hasKey && existsSync(signedPath) && existsSync(pubPath)) {
  try {
    const signed = JSON.parse(readFileSync(signedPath, 'utf8'));
    const pub = createPublicKey(readFileSync(pubPath, 'utf8'));
    if (!verifyManifest(signed, pub)) {
      console.error('[sign] FATAL: committed manifest.signed.json fails verification.');
      process.exit(1);
    }
    console.log('[sign] STREET_PLUGIN_SIGNING_KEY not set — preserving committed signed manifest (verified).');
    process.exit(0);
  } catch (err) {
    console.error('[sign] FATAL: could not validate committed manifest:', err?.message ?? err);
    process.exit(1);
  }
}

let privateKey, publicKey;
if (hasKey) {
  privateKey = createPrivateKey(envKey);
  publicKey = createPublicKey(privateKey);
} else {
  ({ privateKey, publicKey } = generateKeyPairSync('ed25519'));
  console.warn('[sign] STREET_PLUGIN_SIGNING_KEY not set and no signed manifest present — bootstrapping with an ephemeral dev keypair.');
}

const signed = signManifest(manifest, privateKey);
const pubPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
if (!verifyManifest(signed, publicKey)) {
  console.error('[sign] FATAL: produced signature failed verification.');
  process.exit(1);
}
writeFileSync(signedPath, JSON.stringify(signed, null, 2) + '\n');
writeFileSync(pubPath, pubPem);
console.log(`[sign] wrote manifest.signed.json (checksum ${signed.checksum.slice(0, 12)}…)`);
