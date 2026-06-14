#!/usr/bin/env node
// Verifies that every published @streetjs/plugin-* package ships a manifest
// signed by the OFFICIAL StreetJS plugin-signing key. Downloads each package
// tarball from the registry, extracts manifest.signed.json, and verifies its
// Ed25519 signature against OFFICIAL_PLUGIN_PUBLIC_KEY_PEM. Exits non-zero on
// any failure. Pure Node + npm pack — no third-party deps.

import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { verifyManifest, officialPluginPublicKey } from 'streetjs';

const PLUGINS = [
  'redis', 's3', 'r2', 'stripe', 'sendgrid', 'twilio', 'auth0', 'nats', 'kafka',
  'rabbitmq', 'postgres', 'mysql', 'mongodb', 'paypal', 'openai', 'clerk',
  'supabase', 'firebase',
];

const key = officialPluginPublicKey();
let failures = 0;

for (const name of PLUGINS) {
  const pkg = `@streetjs/plugin-${name}`;
  const dir = mkdtempSync(join(tmpdir(), `street-verify-${name}-`));
  try {
    // Download + unpack the published tarball into `dir`.
    const out = execFileSync('npm', ['pack', `${pkg}@latest`, '--silent', `--pack-destination=${dir}`], {
      encoding: 'utf8',
    }).trim();
    const tgz = out.split('\n').pop().trim();
    execFileSync('tar', ['-xzf', join(dir, tgz), '-C', dir]);
    const signed = JSON.parse(readFileSync(join(dir, 'package', 'manifest.signed.json'), 'utf8'));
    if (verifyManifest(signed, key)) {
      console.log(`  ok   ${pkg}@${signed.version} — signed by the official key`);
    } else {
      failures++;
      console.log(`  FAIL ${pkg} — manifest does NOT verify against the official key`);
    }
  } catch (err) {
    failures++;
    console.log(`  FAIL ${pkg} — ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

console.log(
  failures === 0
    ? `\n✅ all ${PLUGINS.length} published plugins verify against the official signing key`
    : `\n❌ ${failures} plugin(s) failed official-signature verification`,
);
process.exit(failures === 0 ? 0 : 1);
