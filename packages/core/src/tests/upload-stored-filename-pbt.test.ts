// tests/upload-stored-filename-pbt.test.ts
// Property-based test for the Upload_Guard (Phase 4, Requirement 5).
//
// Feature: consumer-platform-security, Property 11 — Stored filename is always
// safe.
// Validates: Requirements 5.9
//
// This file proves, across arbitrary client-supplied filenames (including
// path-traversal and separator payloads), that the stored filename the guard
// generates for an accepted upload is always safe per R5.9:
//   - it contains no path separators ("/" or "\") and no NUL byte, so it cannot
//     escape the storage directory, and
//   - it does not contain the client-supplied filename — the stored name is
//     derived solely from random bytes plus a format-derived extension, never
//     from the (untrusted) client filename.
//
// The structural guarantee is asserted directly: the stored name matches
// ^[0-9a-f]{32}\.(jpg|png|gif|pdf)$, i.e. a 16-byte random hex token plus a
// canonical extension chosen from the *detected* (true) format. Because the
// generated hostile filenames always contain a separator or NUL byte (which can
// never appear in lowercase-hex), the client filename can never be a substring
// of the stored name.
//
// Kept in its own *-pbt.test.ts file per the repo convention so the universal
// property is exercised across many generated inputs alongside the
// example/edge-case unit tests in upload-guard.test.ts.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';

import { UploadGuard } from '../multipart/upload-guard.js';
import type { ParsedFile } from '../multipart/parser.js';

const NUM_RUNS = 100;

// ── Supported formats: magic-byte head, declared MIME, canonical extension ──────
interface Format {
  readonly mime: string;
  readonly head: Buffer;
  readonly ext: string;
}

const FORMATS: readonly Format[] = [
  { mime: 'image/jpeg', head: Buffer.from([0xff, 0xd8, 0xff]), ext: 'jpg' },
  {
    mime: 'image/png',
    head: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    ext: 'png',
  },
  { mime: 'image/gif', head: Buffer.from([0x47, 0x49, 0x46, 0x38]), ext: 'gif' },
  { mime: 'application/pdf', head: Buffer.from([0x25, 0x50, 0x44, 0x46]), ext: 'pdf' },
];

// Stored name must be exactly a 16-byte (32 hex char) random token plus one of
// the canonical extensions — nothing client-derived.
const STORED_NAME_RE = /^[0-9a-f]{32}\.(jpg|png|gif|pdf)$/;

const MAX_BYTES = 1 << 20;

// ── Temp-file scaffolding ───────────────────────────────────────────────────────
let dir: string;

before(async () => {
  dir = await mkdtemp(join(tmpdir(), 'upload-storedname-pbt-'));
});
after(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function writeTemp(bytes: Buffer): Promise<string> {
  const p = join(dir, randomBytes(12).toString('hex'));
  await writeFile(p, bytes);
  return p;
}

function parsedFile(path: string, bytes: Buffer, mimeType: string, originalName: string): ParsedFile {
  return { fieldName: 'file', originalName, mimeType, size: bytes.length, path, encoding: '7bit' };
}

// ── Generators ────────────────────────────────────────────────────────────────
const formatArb = fc.constantFrom(...FORMATS);
const tailArb = fc.uint8Array({ maxLength: 64 }).map((u) => Buffer.from(u));

// Hostile client filenames. Every payload embeds a path separator or NUL byte
// so the resulting name is guaranteed to contain a character that can never
// appear in a lowercase-hex stored token — making accidental substring matches
// impossible while exercising the path-traversal/separator surface R5.9 targets.
const separatorPayload = fc.constantFrom(
  '/',
  '\\',
  '../',
  '..\\',
  '/etc/passwd',
  '..\\..\\windows\\system32',
  'a/../../b',
  '\u0000',
  'name\u0000.png',
);
const hostileNameArb = fc
  .tuple(fc.string(), separatorPayload, fc.string())
  .map(([a, sep, b]) => a + sep + b);

// ── Property 11: stored filename is always safe (R5.9) ──────────────────────────

// Feature: consumer-platform-security, Property 11: Stored filename is always safe
// Validates: Requirements 5.9
describe('Property 11: stored filename is always safe', () => {
  it('generates a random, extension-only stored name with no separators and no client filename (R5.9)', async () => {
    await fc.assert(
      fc.asyncProperty(formatArb, tailArb, hostileNameArb, async (fmt, tail, originalName) => {
        const bytes = Buffer.concat([fmt.head, tail]);
        const p = await writeTemp(bytes);
        const guard = new UploadGuard({ maxBytes: MAX_BYTES });

        const { accepted } = await guard.guard(parsedFile(p, bytes, fmt.mime, originalName));
        const { storedName } = accepted;

        // Structural safety: random hex token + canonical, detected-format extension.
        assert.match(storedName, STORED_NAME_RE);

        // No path separators or NUL byte — cannot escape the storage directory.
        assert.ok(!storedName.includes('/'), 'stored name must not contain "/"');
        assert.ok(!storedName.includes('\\'), 'stored name must not contain "\\"');
        assert.ok(!storedName.includes('\u0000'), 'stored name must not contain a NUL byte');

        // The (untrusted) client filename must not appear in the stored name.
        assert.ok(
          !storedName.includes(originalName),
          'stored name must not contain the client-supplied filename',
        );

        // Extension reflects the *detected* format, not anything client-supplied.
        assert.ok(storedName.endsWith(`.${fmt.ext}`));
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('produces a distinct random stored name on each acceptance of identical input (R5.9)', async () => {
    await fc.assert(
      fc.asyncProperty(formatArb, tailArb, async (fmt, tail) => {
        const bytes = Buffer.concat([fmt.head, tail]);
        const guard = new UploadGuard({ maxBytes: MAX_BYTES });

        const p1 = await writeTemp(bytes);
        const p2 = await writeTemp(bytes);
        const a = await guard.guard(parsedFile(p1, bytes, fmt.mime, 'client.png'));
        const b = await guard.guard(parsedFile(p2, bytes, fmt.mime, 'client.png'));

        assert.match(a.accepted.storedName, STORED_NAME_RE);
        assert.match(b.accepted.storedName, STORED_NAME_RE);
        // Random derivation: identical inputs yield different stored names.
        assert.notEqual(a.accepted.storedName, b.accepted.storedName);
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
