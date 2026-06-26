// scripts/security/verify-release.mjs
//
// Release verification (Phase 20, Priority 4). Pure Node — no third-party deps.
// Verifies that every official plugin's committed manifest.signed.json:
//   1. is signed by the official key embedded in official-key.ts, AND
//   2. its manifest.pub matches that same embedded anchor (DER-SHA256).
// Optionally checks npm provenance for published versions with --provenance.
//
// Usage:
//   node scripts/security/verify-release.mjs            # verify all plugins
//   node scripts/security/verify-release.mjs plugin-marzpay
//   node scripts/security/verify-release.mjs --provenance   # also `npm audit signatures`
//
// Exit code 0 = all good; non-zero = a verification failed (CI-friendly).

import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPublicKey, createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const pkgsDir = join(repoRoot, 'packages');

const args = process.argv.slice(2);
const withProvenance = args.includes('--provenance');
const only = args.find((a) => a.startsWith('plugin-'));

function der256(pem) {
  return createHash('sha256')
    .update(createPublicKey(pem).export({ type: 'spki', format: 'der' }))
    .digest('hex');
}

// Embedded official anchor (the trust root consumers verify against).
const anchorSrc = readFileSync(
  join(pkgsDir, 'core', 'src', 'platform', 'plugins', 'official-key.ts'),
  'utf8',
);
const anchorPem = anchorSrc.match(
  /-----BEGIN PUBLIC KEY-----[\s\S]*?-----END PUBLIC KEY-----/,
)?.[0];
if (!anchorPem) {
  console.error('::error:: could not read OFFICIAL_PLUGIN_PUBLIC_KEY_PEM from official-key.ts');
  process.exit(1);
}
const anchor = der256(anchorPem);
console.log(`official anchor DER-SHA256: ${anchor}`);

// Use the framework's own verifier so this matches CI exactly.
let verifyManifest;
try {
  ({ verifyManifest } = await import('streetjs'));
} catch {
  console.error('::error:: cannot import `streetjs` — run `npm run build -w packages/core` first.');
  process.exit(1);
}

const dirs = (only ? [only] : readdirSync(pkgsDir).filter((d) => d.startsWith('plugin-')));
let failed = 0;

for (const d of dirs) {
  const base = join(pkgsDir, d);
  const pubPath = join(base, 'manifest.pub');
  const signedPath = join(base, 'manifest.signed.json');
  if (!existsSync(pubPath) || !existsSync(signedPath)) {
    console.error(`FAIL ${d}: missing manifest.pub or manifest.signed.json`);
    failed++;
    continue;
  }
  const pub = readFileSync(pubPath, 'utf8');
  if (der256(pub) !== anchor) {
    console.error(`FAIL ${d}: manifest.pub does not match the official anchor`);
    failed++;
    continue;
  }
  const signed = JSON.parse(readFileSync(signedPath, 'utf8'));
  if (!verifyManifest(signed, createPublicKey(pub))) {
    console.error(`FAIL ${d}: signature does not verify against manifest.pub`);
    failed++;
    continue;
  }
  console.log(`OK   ${d}`);
}

if (withProvenance) {
  try {
    console.log('\nnpm provenance (npm audit signatures):');
    execFileSync('npm', ['audit', 'signatures'], { stdio: 'inherit', cwd: repoRoot });
  } catch {
    console.error('::warning:: `npm audit signatures` reported issues (see output above).');
  }
}

if (failed) {
  console.error(`\n${failed} plugin(s) failed release verification.`);
  process.exit(1);
}
console.log(`\nAll ${dirs.length} plugin manifest(s) verified against the official anchor ✓`);
