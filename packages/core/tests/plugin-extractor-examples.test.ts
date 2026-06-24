// packages/core/tests/plugin-extractor-examples.test.ts
//
// Feature: plugin-installer-hardening, Property 1: extractor path containment
//   (PS-1 — zip-slip in `_extractTarball`).
//
// DETERMINISTIC EXAMPLE / UNIT TESTS — run against the FIXED `registry.ts`
// (`resolveContained` + two-pass, abort-before-write `_extractTarball`).
//
// Covers (task 4.3):
//   1. `resolveContained` unit table — in-bounds → resolved path; `..`,
//      absolute, escaping → null; single leading `./` and `/` preserved and
//      resolved in-containment.
//   2. Link rejection — symlink ('2') and hardlink ('1') archives each throw
//      and write nothing (the validation pre-pass leaves destDir empty).
//   3. In-containment preservation — `./lib/index.js` extracts to
//      `destDir/lib/index.js` for BOTH raw and gzip archives.
//
// Validates: Requirements 2.1, 2.2, 2.3, 2.4, 3.1, 3.2, 3.3

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { promises as fs } from 'node:fs';

import { PluginInstaller, resolveContained } from '../src/platform/plugins/registry.js';
import {
  makeTar,
  gzip,
  fileEntry,
  dotSlashFileEntry,
  slashFileEntry,
  symlinkEntry,
  hardlinkEntry,
} from './helpers/plugin-archive.js';
import { withTempDir } from './helpers/plugin-registry-stub.js';

// ── Internals view ────────────────────────────────────────────────────────────

/** Minimal view onto the installer's private extractor exercised by this test. */
interface InstallerInternals {
  _extractTarball(buffer: Buffer, destDir: string): Promise<void>;
}

function internalsOf(installer: PluginInstaller): InstallerInternals {
  return installer as unknown as InstallerInternals;
}

/** Collect every absolute path (files AND directories) under `root`. */
async function walkAll(root: string): Promise<string[]> {
  const out: string[] = [];
  async function walk(dir: string): Promise<void> {
    let dirents;
    try {
      dirents = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const d of dirents) {
      const abs = path.resolve(dir, d.name);
      out.push(abs);
      if (d.isDirectory()) await walk(abs);
    }
  }
  await walk(root);
  return out;
}

// ── 1. resolveContained unit table ────────────────────────────────────────────

describe('resolveContained — unit table (PS-1 containment guard)', () => {
  // An absolute extraction root keeps path.resolve deterministic across machines.
  const destDir = path.resolve(path.sep, 'var', 'lib', 'streetjs', 'plugins', 'pkg@1.0.0');
  const destRoot = path.resolve(destDir);

  // In-bounds entries resolve to their normalized in-containment absolute path.
  // Validates: Requirements 3.1
  it('resolves in-bounds entries to their contained absolute path', () => {
    const cases: Array<[string, string]> = [
      ['index.js', path.join(destRoot, 'index.js')],
      ['lib/index.js', path.join(destRoot, 'lib', 'index.js')],
      ['a/b/c/d.js', path.join(destRoot, 'a', 'b', 'c', 'd.js')],
      ['pkg/dist/main.js', path.join(destRoot, 'pkg', 'dist', 'main.js')],
    ];
    for (const [entryName, expected] of cases) {
      assert.equal(
        resolveContained(destDir, entryName),
        expected,
        `expected "${entryName}" to resolve to ${expected}`,
      );
    }
  });

  // The extraction root itself ("." / "") resolves to destRoot (contained).
  // Validates: Requirements 3.1
  it('resolves "." and "" to the extraction root itself', () => {
    assert.equal(resolveContained(destDir, '.'), destRoot);
    assert.equal(resolveContained(destDir, ''), destRoot);
  });

  // `..` path segments at any position are rejected (→ null).
  // Validates: Requirements 2.1, 2.4
  it('rejects ".." traversal entries (→ null)', () => {
    const traversals = [
      '../evil.txt',
      '../../evil.txt',
      '../../../../home/user/.bashrc',
      'lib/../../evil.txt',
      'a/b/../../../escape.sh',
      '..',
    ];
    for (const name of traversals) {
      assert.equal(resolveContained(destDir, name), null, `expected "${name}" → null`);
    }
  });

  // Absolute entries that survive the single leading-slash strip are rejected.
  // (A double leading slash leaves an absolute path after stripping one slash.)
  // Validates: Requirements 2.2
  it('rejects absolute entries that remain absolute after the single-slash strip (→ null)', () => {
    const absolutes = ['//etc/passwd', '//tmp/streetjs-evil.txt', '//var/evil.conf'];
    for (const name of absolutes) {
      assert.equal(resolveContained(destDir, name), null, `expected "${name}" → null`);
    }
  });

  // A single leading `./` or `/` is preserved (stripped) and the remainder
  // resolves in-containment — Req 3.2 normalization is not broken by the guard.
  // Validates: Requirements 3.2
  it('preserves a single leading "./" or "/" and resolves in-containment', () => {
    const expected = path.join(destRoot, 'lib', 'index.js');
    assert.equal(resolveContained(destDir, './lib/index.js'), expected);
    assert.equal(resolveContained(destDir, '/lib/index.js'), expected);
    // A single leading "/" before a plain file too.
    assert.equal(resolveContained(destDir, '/index.js'), path.join(destRoot, 'index.js'));
  });
});

// ── 2. Link rejection — throw and write nothing ───────────────────────────────

describe('_extractTarball — link entries are rejected and write nothing (PS-1)', () => {
  // Symlink ('2') archives are rejected by the validation pre-pass; because the
  // pre-pass precedes any write, destDir is left empty.
  // Validates: Requirements 2.3, 2.4
  it('throws on a symlink ("2") entry and leaves destDir empty', async () => {
    const { dir: root, cleanup } = await withTempDir();
    try {
      const destDir = path.join(root, 'pkg@1.0.0');
      await fs.mkdir(destDir, { recursive: true });

      // A benign file alongside the link must NOT be written: the two-pass
      // extractor validates everything before writing anything.
      const tar = makeTar([
        fileEntry('lib/index.js', 'ok'),
        symlinkEntry('link', '/etc/passwd'),
      ]);

      const installer = new PluginInstaller({ pluginsDir: root });
      await assert.rejects(
        () => internalsOf(installer)._extractTarball(tar, destDir),
        /link entry/i,
        'expected symlink entry to be rejected by throwing',
      );

      assert.deepEqual(await walkAll(destDir), [], 'expected destDir to remain empty after rejection');
    } finally {
      await cleanup();
    }
  });

  // Hardlink ('1') archives are likewise rejected with no write.
  // Validates: Requirements 2.3, 2.4
  it('throws on a hardlink ("1") entry and leaves destDir empty', async () => {
    const { dir: root, cleanup } = await withTempDir();
    try {
      const destDir = path.join(root, 'pkg@1.0.0');
      await fs.mkdir(destDir, { recursive: true });

      const tar = makeTar([
        fileEntry('lib/index.js', 'ok'),
        hardlinkEntry('hard', 'lib/index.js'),
      ]);

      const installer = new PluginInstaller({ pluginsDir: root });
      await assert.rejects(
        () => internalsOf(installer)._extractTarball(tar, destDir),
        /link entry/i,
        'expected hardlink entry to be rejected by throwing',
      );

      assert.deepEqual(await walkAll(destDir), [], 'expected destDir to remain empty after rejection');
    } finally {
      await cleanup();
    }
  });
});

// ── 3. In-containment preservation — raw and gzip ─────────────────────────────

describe('_extractTarball — in-containment "./lib/index.js" extraction (raw + gzip)', () => {
  for (const [label, useGzip] of [['raw', false], ['gzip', true]] as const) {
    // A single leading `./` entry extracts to destDir/lib/index.js unchanged in
    // both raw and gzip form (Req 3.2, 3.3 — preservation).
    // Validates: Requirements 3.1, 3.2, 3.3
    it(`extracts ./lib/index.js to destDir/lib/index.js (${label})`, async () => {
      const { dir: root, cleanup } = await withTempDir();
      try {
        const destDir = path.join(root, 'pkg@1.0.0');
        await fs.mkdir(destDir, { recursive: true });

        const rawTar = makeTar([dotSlashFileEntry('lib/index.js', 'module.exports = 1;')]);
        const tar = useGzip ? gzip(rawTar) : rawTar;

        const installer = new PluginInstaller({ pluginsDir: root });
        await internalsOf(installer)._extractTarball(tar, destDir);

        const expected = path.join(destDir, 'lib', 'index.js');
        const st = await fs.stat(expected);
        assert.equal(st.isFile(), true, `expected file at ${expected}`);
        assert.equal(await fs.readFile(expected, 'utf8'), 'module.exports = 1;');
      } finally {
        await cleanup();
      }
    });
  }

  // The equivalent single leading `/` entry also lands in-containment (Req 3.2).
  // Validates: Requirements 3.1, 3.2
  it('extracts /lib/index.js to destDir/lib/index.js', async () => {
    const { dir: root, cleanup } = await withTempDir();
    try {
      const destDir = path.join(root, 'pkg@1.0.0');
      await fs.mkdir(destDir, { recursive: true });

      const tar = makeTar([slashFileEntry('lib/index.js', 'ok')]);

      const installer = new PluginInstaller({ pluginsDir: root });
      await internalsOf(installer)._extractTarball(tar, destDir);

      const expected = path.join(destDir, 'lib', 'index.js');
      assert.equal(await fs.readFile(expected, 'utf8'), 'ok');
    } finally {
      await cleanup();
    }
  });
});
