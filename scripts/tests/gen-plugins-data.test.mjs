// scripts/tests/gen-plugins-data.test.mjs
//
// Integration test for the Marketplace_Generator (scripts/gen-plugins-data.mjs)
// covering the MarzPay marketplace-integration acceptance criteria:
//
//   • Req 12.1 — a LISTED (non-private, not streetjs.unlisted) MarzPay package
//     with the `payments` keyword produces a marketplace entry under `Payments`.
//   • Req 12.2 / 12.5 — the generator produces ALL THREE artifacts and makes the
//     plugin discoverable through both a `Payments` category row and a dedicated
//     detail page: (a) the data entry in docs/_data/plugins.json, (b) a MarzPay
//     row in docs/plugins/category/payments.md, (c) a detail page
//     docs/plugins/registry/marzpay.md (permalink /plugins/marzpay/).
//   • Req 12.3-adjacent — the entry derives title/description/version/category
//     ONLY from the package.json name/description/version/keywords.
//   • Req 12.4 — when the package sets streetjs.unlisted=true OR private=true it
//     is excluded from the data entry, the category listing, and the detail page.
//
// Isolation strategy (does NOT touch the committed docs/ or packages/):
//   The generator computes its root from its own file location (import.meta.url)
//   and reads <root>/packages/plugin-* / writes <root>/docs/* with no arg/env
//   override. So this test copies the REAL generator source into a throwaway temp
//   directory's scripts/ folder, stages fixture plugin packages under the temp
//   packages/, runs it, and inspects the temp docs/ output. The actual generator
//   code is exercised; the repository's committed artifacts are never modified.
//
// **Validates: Requirements 12.1, 12.2, 12.4, 12.5**

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync,
  existsSync, rmSync, copyFileSync,
} from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..');
const realGenerator = join(repoRoot, 'scripts', 'gen-plugins-data.mjs');

// A MarzPay-like fixture mirroring the real packages/plugin-marzpay/package.json
// (same name/description/version and the `payments` keyword that the generator's
// Payments matcher recognizes). The `streetjs` field is supplied per-scenario.
function marzpayPkg(extra = {}) {
  return {
    name: '@streetjs/plugin-marzpay',
    version: '1.0.0',
    description: 'Official StreetJS plugin: MarzPay payments (dependency-free HTTPS client).',
    type: 'module',
    keywords: ['street', 'streetjs', 'plugin', 'marzpay', 'payments'],
    license: 'MIT',
    ...extra,
  };
}

let tmpRoot;
let tmpGenerator;
const tmpPkgsDir = () => join(tmpRoot, 'packages');
const dataFile = () => join(tmpRoot, 'docs', '_data', 'plugins.json');
const paymentsCatFile = () => join(tmpRoot, 'docs', 'plugins', 'category', 'payments.md');
const marzpayDetailFile = () => join(tmpRoot, 'docs', 'plugins', 'registry', 'marzpay.md');

before(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), 'gen-plugins-data-'));
  mkdirSync(join(tmpRoot, 'scripts'), { recursive: true });
  // Copy the REAL generator so we exercise the actual current code, isolated.
  tmpGenerator = join(tmpRoot, 'scripts', 'gen-plugins-data.mjs');
  copyFileSync(realGenerator, tmpGenerator);
});

after(() => {
  if (tmpRoot && existsSync(tmpRoot)) rmSync(tmpRoot, { recursive: true, force: true });
});

/**
 * Stage the given fixture plugin packages under the temp packages/ dir, wipe any
 * previous generated docs/, run the real generator against the temp root, and
 * return the parsed/raw artifacts for assertions.
 *
 * @param {Record<string, object>} packages map of dir name (e.g. "plugin-marzpay") -> package.json object
 */
function runGenerator(packages) {
  // Clean any previous run's inputs and outputs so scenarios don't bleed.
  rmSync(tmpPkgsDir(), { recursive: true, force: true });
  rmSync(join(tmpRoot, 'docs'), { recursive: true, force: true });
  mkdirSync(tmpPkgsDir(), { recursive: true });

  for (const [dir, pj] of Object.entries(packages)) {
    const pkgDir = join(tmpPkgsDir(), dir);
    mkdirSync(pkgDir, { recursive: true });
    writeFileSync(join(pkgDir, 'package.json'), JSON.stringify(pj, null, 2));
  }

  execFileSync('node', [tmpGenerator], { stdio: 'pipe' });

  const data = JSON.parse(readFileSync(dataFile(), 'utf8'));
  const catDir = join(tmpRoot, 'docs', 'plugins', 'category');
  const regDir = join(tmpRoot, 'docs', 'plugins', 'registry');
  return {
    data,
    categoryFiles: existsSync(catDir) ? readdirSync(catDir) : [],
    registryFiles: existsSync(regDir) ? readdirSync(regDir) : [],
  };
}

describe('Marketplace_Generator — MarzPay marketplace integration (gen-plugins-data.mjs)', () => {
  it('LISTED: produces all three artifacts under Payments and derives fields only from package.json (Req 12.1, 12.2, 12.5)', () => {
    const { data } = runGenerator({ 'plugin-marzpay': marzpayPkg() });

    // ── Artifact 1: the marketplace DATA ENTRY ──────────────────────────────
    const entry = data.plugins.find((p) => p.name === '@streetjs/plugin-marzpay');
    assert.ok(entry, 'marzpay should appear in docs/_data/plugins.json plugins[]');

    // Routed to the existing Payments category (Req 12.1).
    assert.equal(entry.category, 'Payments', 'payments keyword must route to the Payments category');
    assert.equal(entry.catSlug, 'payments');
    assert.equal(entry.slug, 'marzpay');

    // Fields derived ONLY from package.json name/description/version/keywords (Req 12.3 adjacent).
    assert.equal(entry.title, 'Marzpay', 'title derived from package name');
    assert.equal(entry.version, '1.0.0', 'version derived from package version');
    assert.equal(
      entry.description,
      'Official StreetJS plugin: MarzPay payments (dependency-free HTTPS client).',
      'description derived from package description',
    );

    // Payments must be a listed category and the entry counted.
    assert.ok(data.categories.some((c) => c.name === 'Payments' && c.slug === 'payments'));
    assert.equal(data.count, 1);

    // ── Artifact 2: the Payments CATEGORY ROW (Req 12.2, 12.5) ───────────────
    assert.ok(existsSync(paymentsCatFile()), 'docs/plugins/category/payments.md should exist');
    const catMd = readFileSync(paymentsCatFile(), 'utf8');
    assert.match(catMd, /permalink:\s+\/plugins\/category\/payments\//);
    assert.ok(
      catMd.includes('@streetjs/plugin-marzpay') && catMd.includes('/StreetJS/plugins/marzpay/'),
      'Payments category page should contain a MarzPay row linking to its detail page',
    );

    // ── Artifact 3: the DETAIL PAGE (Req 12.2, 12.5) ─────────────────────────
    assert.ok(existsSync(marzpayDetailFile()), 'docs/plugins/registry/marzpay.md should exist');
    const detailMd = readFileSync(marzpayDetailFile(), 'utf8');
    assert.match(detailMd, /permalink:\s+\/plugins\/marzpay\//, 'detail page route is /plugins/marzpay/');
    assert.ok(detailMd.includes('@streetjs/plugin-marzpay'), 'detail page names the plugin');
    assert.ok(detailMd.includes('v1.0.0'), 'detail page shows the package version');
  });

  it('UNLISTED (streetjs.unlisted=true): excluded from the data entry, the Payments row, and the detail page (Req 12.4)', () => {
    const { data, registryFiles } = runGenerator({
      'plugin-marzpay': marzpayPkg({ streetjs: { unlisted: true } }),
    });

    // No data entry.
    assert.equal(
      data.plugins.find((p) => p.name === '@streetjs/plugin-marzpay'),
      undefined,
      'unlisted plugin must not appear in plugins.json',
    );
    assert.equal(data.count, 0);

    // No Payments category page row — with no listed plugins there is no Payments
    // category at all; if it exists it must not reference marzpay.
    if (existsSync(paymentsCatFile())) {
      const catMd = readFileSync(paymentsCatFile(), 'utf8');
      assert.ok(!catMd.includes('@streetjs/plugin-marzpay'), 'no MarzPay row when unlisted');
    }

    // No detail page.
    assert.ok(!existsSync(marzpayDetailFile()), 'no detail page when unlisted');
    assert.ok(!registryFiles.includes('marzpay.md'));
  });

  it('PRIVATE (private=true): excluded from the data entry, the Payments row, and the detail page (Req 12.4)', () => {
    const { data, registryFiles } = runGenerator({
      'plugin-marzpay': marzpayPkg({ private: true }),
    });

    assert.equal(
      data.plugins.find((p) => p.name === '@streetjs/plugin-marzpay'),
      undefined,
      'private plugin must not appear in plugins.json',
    );
    assert.equal(data.count, 0);

    if (existsSync(paymentsCatFile())) {
      const catMd = readFileSync(paymentsCatFile(), 'utf8');
      assert.ok(!catMd.includes('@streetjs/plugin-marzpay'), 'no MarzPay row when private');
    }

    assert.ok(!existsSync(marzpayDetailFile()), 'no detail page when private');
    assert.ok(!registryFiles.includes('marzpay.md'));
  });

  it('LISTED alongside an unlisted sibling: only the listed plugin is emitted (Req 12.1, 12.4)', () => {
    const { data } = runGenerator({
      'plugin-marzpay': marzpayPkg(),
      'plugin-secret-pay': marzpayPkg({
        name: '@streetjs/plugin-secret-pay',
        streetjs: { unlisted: true },
      }),
    });

    const names = data.plugins.map((p) => p.name);
    assert.ok(names.includes('@streetjs/plugin-marzpay'), 'listed plugin present');
    assert.ok(!names.includes('@streetjs/plugin-secret-pay'), 'unlisted sibling excluded');
    assert.equal(data.count, 1);
  });
});
