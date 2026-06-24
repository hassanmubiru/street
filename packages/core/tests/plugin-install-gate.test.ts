// packages/core/tests/plugin-install-gate.test.ts
//
// Feature: plugin-installer-hardening, Property 2: fail-closed install gate
//   (PS-2 — default-open installer with a self-referential integrity check).
//
// FIX-CHECKING PROPERTY TEST — runs against the FIXED `registry.ts`
// (secure-by-default `trustedKey`, `assertHttps`, `installerManifestSchema`
// validation in `_fetchManifest`, reordered fail-closed `install()` verifying
// over the RECOMPUTED canonical checksum via `verifyManifest`).
//
// Property 2 (design "Correctness Properties"):
//   For any installer configuration and registry response where the install bug
//   condition holds (`isBugConditionInstall` — no trust anchor without explicit
//   `allowUnsigned`, schema-invalid manifest, missing/invalid signature,
//   non-`https:` transport, or integrity resting solely on the supplied
//   checksum), the fixed `install` SHALL abort by throwing BEFORE any tarball is
//   downloaded or extracted, performing no filesystem side effects. The install
//   SHALL succeed iff: a signature verifies against the trusted key (recomputing
//   the canonical checksum) AND the manifest conforms to the schema AND both
//   transport URLs are `https:` AND the downloaded tarball's SHA-256 equals the
//   signed checksum — OR `allowUnsigned: true` is explicitly set (still
//   enforcing https + schema + signature-presence + integrity + PS-1
//   containment, waiving only signature verification).
//
// Validates: Requirements 2.5, 2.6, 2.7, 2.8, 2.9
//
// ── Modeling subtleties matched against the implementation ───────────────────
//   1. allowUnsigned is the DOCUMENTED escape hatch (Property 2's "OR
//      allowUnsigned" success clause). The formal `isBugConditionInstall` lists
//      "integrity rests solely on the registry-supplied checksum", which is
//      literally true of allowUnsigned mode (compareTarget = manifest.checksum);
//      we treat the explicit opt-in as the intended exception, NOT a bug, exactly
//      as the implementation and Property 2 do.
//   2. `_fetchManifest` requires a `signature` field even in allowUnsigned mode,
//      so a signature-ABSENT manifest aborts before download regardless of
//      allowUnsigned (only signature *verification* is waived, not presence).
//   3. The tarball-hash↔checksum gate (step (g)) fires AFTER the tarball is
//      downloaded but BEFORE mkdir/extract. So a pure checksum mismatch (all
//      pre-download gates pass) is the one abort case where the DOWNLOAD spy is
//      reached — yet extraction never runs and no directory is created, so there
//      are still zero filesystem side effects. This is NOT a bug condition per
//      the formal spec; it is the integrity binding Property 2 also requires.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import fc from 'fast-check';

import {
  PluginInstaller,
  type PluginInstallerOptions,
} from '../src/platform/plugins/registry.js';
import {
  signManifest,
  manifestChecksum,
  type PluginManifest,
} from '../src/platform/plugins/host.js';
import {
  generateKeypair,
  exportPublicKeyPem,
  RegistryStub,
  withTempDir,
  type Keypair,
  type InstallerManifest,
} from './helpers/plugin-registry-stub.js';
import { makeTar, fileEntry } from './helpers/plugin-archive.js';

// ── Pure helpers ──────────────────────────────────────────────────────────────

/**
 * Replicate host.ts's private `canonicalManifest` EXACTLY so the test can build
 * the byte preimage whose SHA-256 equals `manifestChecksum(body)` — i.e. the
 * tarball that satisfies the installer's integrity binding
 * (`sha256(tarball) === manifestChecksum(manifest)`). The fix does not change
 * `canonicalManifest`, so this stays stable across the fix.
 */
function canonicalManifestString(m: PluginManifest): string {
  const body = {
    name: m.name,
    version: m.version,
    capabilities: [...(m.capabilities ?? [])].sort(),
    permissions: [...(m.permissions ?? [])].sort(),
    dependencies: Object.fromEntries(
      Object.entries(m.dependencies ?? {}).sort(([a], [b]) => (a < b ? -1 : 1)),
    ),
  };
  return JSON.stringify(body);
}

/** True iff `raw` parses as a URL whose protocol is exactly `https:`. */
function isHttps(raw: string): boolean {
  try {
    return new URL(raw).protocol === 'https:';
  } catch {
    return false;
  }
}

/** Corrupt a base64 Ed25519 signature so it can never verify (keeps it valid base64). */
function tamperSignature(sig: string): string {
  const buf = Buffer.from(sig, 'base64');
  buf[0] = buf[0]! ^ 0xff;
  return buf.toString('base64');
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

// ── Scenario dimensions ───────────────────────────────────────────────────────

type SigMode = 'valid' | 'wrongKey' | 'tampered' | 'absent';
type SchemaBreak = 'none' | 'invalidField' | 'malformedJson';
type Scheme = 'https' | 'http' | 'file';

interface Dims {
  /** Installer is given its own trusted public key (the `own` keypair). */
  useOwnKey: boolean;
  /** Explicit unsigned/dev escape hatch. */
  allowUnsigned: boolean;
  sigMode: SigMode;
  schemaBreak: SchemaBreak;
  registryScheme: Scheme;
  tarballScheme: Scheme;
  /** Whether the served tarball's SHA-256 matches the (real) canonical checksum. */
  tarballMatch: boolean;
  name: string;
  version: string;
}

const dimsArb: fc.Arbitrary<Dims> = fc.record({
  useOwnKey: fc.boolean(),
  allowUnsigned: fc.boolean(),
  sigMode: fc.constantFrom<SigMode>('valid', 'wrongKey', 'tampered', 'absent'),
  schemaBreak: fc.constantFrom<SchemaBreak>('none', 'invalidField', 'malformedJson'),
  registryScheme: fc.constantFrom<Scheme>('https', 'http', 'file'),
  tarballScheme: fc.constantFrom<Scheme>('https', 'http', 'file'),
  tarballMatch: fc.boolean(),
  name: fc.constantFrom('alpha', 'beta', 'payments-x'),
  version: fc.constantFrom('1.0.0', '2.3.4'),
});

// ── Models: the success predicate and the design's bug-condition predicate ────

type Outcome = 'success' | 'abortBeforeDownload' | 'abortAfterDownload';

/**
 * Would the signature verify against the installer's trusted key?
 *  - Only a `valid` signature can verify.
 *  - It must be verified against the SAME key it was signed with, which only
 *    happens when the installer is given the `own` public key (`useOwnKey`).
 *    When no key is supplied (and not allowUnsigned) the trust anchor defaults
 *    to the official key, against which our self-signed manifest never verifies.
 * Matches `verifyManifest` because the canonical checksum is always real in
 * every signed case (we only ever tamper the signature bytes, never the body).
 */
function sigWouldVerify(d: Dims): boolean {
  return d.sigMode === 'valid' && d.useOwnKey;
}

function registryUrlOf(d: Dims): string {
  return `${d.registryScheme}://registry.streetjs.dev`;
}
function tarballUrlOf(d: Dims): string {
  return `${d.tarballScheme}://cdn.streetjs.dev/${d.name}-${d.version}.tgz`;
}

/**
 * The expected outcome, following the implementation's gate ordering (a)-(h):
 *   (a) registry https → (b/c) JSON parse + schema + signature-presence →
 *   (d) tarball https → (e) signature verify (skipped when allowUnsigned) →
 *   (f) download → (g) tarball-hash↔checksum → (h) extract.
 */
function expectedOutcome(d: Dims): Outcome {
  // (a) registry transport must be https — checked before any fetch.
  if (!isHttps(registryUrlOf(d))) return 'abortBeforeDownload';
  // (b/c) _fetchManifest: JSON parse, then schema, then signature-presence.
  if (d.schemaBreak === 'malformedJson') return 'abortBeforeDownload';
  if (d.schemaBreak === 'invalidField') return 'abortBeforeDownload';
  // Signature field is REQUIRED even in allowUnsigned mode (subtlety #2).
  if (d.sigMode === 'absent') return 'abortBeforeDownload';
  // (d) tarball transport must be https.
  if (!isHttps(tarballUrlOf(d))) return 'abortBeforeDownload';
  // (e) signature verification — only enforced when NOT allowUnsigned.
  if (!d.allowUnsigned && !sigWouldVerify(d)) return 'abortBeforeDownload';
  // (f) download reached. (g) integrity binding.
  if (!d.tarballMatch) return 'abortAfterDownload';
  // (h) extract → success.
  return 'success';
}

/**
 * The design's `isBugConditionInstall(installer, response)` predicate. allowUnsigned
 * is the documented escape hatch (subtlety #1) so it is not a bug condition on
 * its own. This set is exactly the pre-download abort set, so it must equal
 * `expectedOutcome(d) === 'abortBeforeDownload'`.
 */
function isBugConditionInstall(d: Dims): boolean {
  if (d.schemaBreak !== 'none') return true; // schema-invalid OR malformed JSON
  if (d.sigMode === 'absent') return true; // no signature
  if (!isHttps(registryUrlOf(d)) || !isHttps(tarballUrlOf(d))) return true; // non-https
  if (!d.allowUnsigned && !sigWouldVerify(d)) return true; // no/failed verification vs trusted key
  return false;
}

// ── Property 2 — fail-closed install gate ─────────────────────────────────────

describe('Property 2 — fail-closed install gate (PS-2, fixed install())', () => {
  // Feature: plugin-installer-hardening, Property 2: fail-closed install gate.
  // Validates: Requirements 2.5, 2.6, 2.7, 2.8, 2.9
  it('installs iff signature(+recomputed checksum)/schema/https/integrity all hold OR allowUnsigned; else aborts with no download/extract side effects', async () => {
    // Stable trust anchors for the whole property (Ed25519 keygen is cheap but
    // deterministic enough to do once): `own` is the key the installer trusts,
    // `other` produces signatures that never verify against it.
    const own: Keypair = generateKeypair();
    const other: Keypair = generateKeypair();
    const ownPubPem = exportPublicKeyPem(own.publicKey);

    // Silence the allowUnsigned escape-hatch warning emitted in the constructor.
    const originalWarn = console.warn;
    console.warn = () => {};

    try {
      await fc.assert(
        fc.asyncProperty(dimsArb, async (d) => {
          const { dir: pluginsDir, cleanup } = await withTempDir();
          try {
            // ── Build the signable body (break the schema via an empty name) ──
            const breakField = d.schemaBreak === 'invalidField';
            const body: PluginManifest = {
              name: breakField ? '' : d.name,
              version: d.version,
              capabilities: ['x'],
              permissions: [],
              dependencies: {},
            };

            // ── Sign the manifest per the chosen signature mode ──
            const signingKey =
              d.sigMode === 'wrongKey' ? other.privateKey : own.privateKey;

            let signed: PluginManifest;
            if (d.sigMode === 'absent') {
              // Real checksum, but NO signature field.
              signed = { ...body, checksum: manifestChecksum(body) };
            } else {
              signed = signManifest(body, signingKey);
              if (d.sigMode === 'tampered') {
                // Corrupt only the signature bytes — checksum stays real so the
                // integrity binding (and allowUnsigned's manifest.checksum path)
                // is unaffected; only verification fails.
                signed = { ...signed, signature: tamperSignature(signed.signature!) };
              }
            }

            const tarballUrl = tarballUrlOf(d);
            const manifestObj: InstallerManifest = { ...signed, tarballUrl };

            const manifestBody =
              d.schemaBreak === 'malformedJson'
                ? '{ this is : not valid json'
                : JSON.stringify(manifestObj);

            // ── Build the served tarball ──
            // Matching: the canonical-body preimage whose SHA-256 == the real
            // checksum (and which carries no parseable tar entry → empty dir).
            const matchingTarball = Buffer.from(canonicalManifestString(body), 'utf8');
            // Non-matching: a real in-containment tar with a different hash.
            const nonMatchingTarball = makeTar([fileEntry('lib/index.js', 'noop')]);
            const tarball = d.tarballMatch ? matchingTarball : nonMatchingTarball;

            const registryUrl = registryUrlOf(d);

            // ── Construct the installer + stub network layer ──
            const opts: PluginInstallerOptions = { pluginsDir, registryUrl };
            if (d.useOwnKey) opts.publicKey = ownPubPem;
            if (d.allowUnsigned) opts.allowUnsigned = true;
            const installer = new PluginInstaller(opts);

            const stub = new RegistryStub({ registryUrl, tarballUrl, manifestBody, tarball });
            stub.attachTo(installer);

            // ── Expected outcome + design cross-checks ──
            const expected = expectedOutcome(d);
            assert.equal(
              isBugConditionInstall(d),
              expected === 'abortBeforeDownload',
              'isBugConditionInstall must coincide with the pre-download abort set',
            );

            // ── Run install ──
            let threw = false;
            try {
              await installer.install(d.name, d.version);
            } catch {
              threw = true;
            }

            const destDir = path.join(pluginsDir, `${d.name}@${d.version}`);
            const dirEntries = await fs.readdir(pluginsDir);

            assert.equal(
              threw,
              expected !== 'success',
              `throw mismatch: expected outcome=${expected}, threw=${threw}`,
            );

            if (expected === 'success') {
              // Full pipeline ran: verify → download → checksum → extract.
              assert.equal(stub.downloadReached, true, 'tarball downloaded on success');
              assert.equal(stub.extractReached, true, 'tarball extracted on success');
              assert.equal(await pathExists(destDir), true, 'plugin dir created on success');
            } else if (expected === 'abortBeforeDownload') {
              // Aborted BEFORE any download/extract — no side effects (Req 2.9).
              assert.equal(stub.downloadReached, false, 'no tarball downloaded on pre-download abort');
              assert.equal(stub.extractReached, false, 'no extraction on pre-download abort');
              assert.deepEqual(dirEntries, [], 'no filesystem side effects on abort');
            } else {
              // Checksum mismatch: download reached, but extract never runs and
              // no directory is created (mkdir is post-checksum), so still zero
              // filesystem side effects (Req 2.6, 2.9).
              assert.equal(stub.downloadReached, true, 'tarball downloaded before integrity gate');
              assert.equal(stub.extractReached, false, 'no extraction on checksum mismatch');
              assert.deepEqual(dirEntries, [], 'no filesystem side effects on checksum mismatch');
            }
          } finally {
            await cleanup();
          }
        }),
        { numRuns: 200 },
      );
    } finally {
      console.warn = originalWarn;
    }
  });
});
