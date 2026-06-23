#!/usr/bin/env node
// scripts/check-demos.mjs
// Probes each live-demo's GET /health/ready and reports status. Optionally
// updates docs/_data/demos.json so the showcase "Live demo" badge reflects
// reality (rendered in Liquid from site.data.demos — see docs/showcase.md).
//
// Dependency-free (node:https/http only). NOT wired into the Pages build on
// purpose: a network probe at build time could break deploys or hide a demo on
// a transient failure. Run it manually or from a SCHEDULED workflow (see
// DEMO-INFRA-PLAN.md §6), then commit the updated demos.json.
//
// Usage:
//   node scripts/check-demos.mjs            # probe + print a report (no writes)
//   node scripts/check-demos.mjs --write    # also update status in demos.json
//
// Status rules (only for demos that declare a non-empty `url`):
//   /health/ready → 200  ⇒ status "live"
//   anything else        ⇒ status "down"
// Demos with status "roadmap" or an empty `url` are never probed or modified.

import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import https from 'node:https';
import http from 'node:http';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dataPath = join(root, 'docs', '_data', 'demos.json');
const write = process.argv.includes('--write');
const TIMEOUT_MS = 8000;

function probe(url) {
  return new Promise((resolve) => {
    let target;
    try { target = new URL('/health/ready', url); } catch { return resolve({ ok: false, reason: 'bad url' }); }
    const lib = target.protocol === 'http:' ? http : https;
    const req = lib.get(target, { timeout: TIMEOUT_MS }, (res) => {
      res.resume(); // drain
      resolve({ ok: res.statusCode === 200, reason: `HTTP ${res.statusCode}` });
    });
    req.on('timeout', () => { req.destroy(); resolve({ ok: false, reason: 'timeout' }); });
    req.on('error', (e) => resolve({ ok: false, reason: e.code || e.message }));
  });
}

const data = JSON.parse(readFileSync(dataPath, 'utf8'));
let changed = 0;
let anyDown = false;

for (const d of data.demos) {
  if (d.status === 'roadmap' || !d.url) {
    console.log(`- ${d.slug.padEnd(16)} ${d.status === 'roadmap' ? 'roadmap (skip)' : 'no url (source-only)'}`);
    continue;
  }
  const { ok, reason } = await probe(d.url);
  const next = ok ? 'live' : 'down';
  if (ok) console.log(`✓ ${d.slug.padEnd(16)} live   (${d.url} — ${reason})`);
  else { console.log(`✗ ${d.slug.padEnd(16)} DOWN   (${d.url} — ${reason})`); anyDown = true; }
  if (d.status !== next) { d.status = next; changed++; }
}

if (write && changed > 0) {
  data.generated = new Date().toISOString().slice(0, 10);
  writeFileSync(dataPath, JSON.stringify(data, null, 2) + '\n');
  console.log(`\n[check-demos] Updated ${changed} status(es) in docs/_data/demos.json.`);
} else if (write) {
  console.log('\n[check-demos] No status changes.');
} else if (changed > 0) {
  console.log(`\n[check-demos] ${changed} status(es) would change — re-run with --write to apply.`);
}

// Report-only; never fail the process for a down demo (a scheduled workflow can
// decide whether a down demo warrants an alert). Exit non-zero only on no demos.
if (data.demos.length === 0) { console.error('[check-demos] No demos defined.'); process.exit(1); }
process.exit(0);
