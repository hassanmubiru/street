#!/usr/bin/env node
// scripts/cloud/build-report.mjs
//
// Build the cross-target deployment verification report (Requirement 2.11) from
// the per-target `TargetVerification` results emitted by
// `scripts/cloud/verify-target.mjs`. Reads every
// `verification-artifacts/cloud/targets/*.json`, rolls them up through
// `buildDeploymentReport` from @streetjs/core (which re-classifies each target
// against the bounds and stamps an ISO-8601 run timestamp), and writes:
//
//   verification-artifacts/cloud/deployment-report.json
//
// Usage:
//   node scripts/cloud/build-report.mjs [--targets-dir <dir>] [--out <file>]
//
// Exit code: 0 when every target is VERIFIED, 1 otherwise (so the CI roll-up
// step fails when any target is PARTIAL/BLOCKED/NOT_IMPLEMENTED).

import { mkdirSync, readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { buildDeploymentReport } from 'streetjs';
import { parseFlags } from './lib.mjs';

/** Read every per-target result JSON from `targetsDir`. */
export function readTargetResults(targetsDir) {
  if (!existsSync(targetsDir)) return [];
  return readdirSync(targetsDir)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => JSON.parse(readFileSync(join(targetsDir, f), 'utf8')));
}

function main() {
  const flags = parseFlags(process.argv.slice(2));
  const outRoot = flags.out ? undefined : 'verification-artifacts';
  const targetsDir = resolve(flags['targets-dir'] ?? join(outRoot ?? '.', 'cloud', 'targets'));
  const outPath = resolve(flags.out ?? join(outRoot ?? '.', 'cloud', 'deployment-report.json'));

  const results = readTargetResults(targetsDir);
  if (results.length === 0) {
    console.error(`[cloud-report] no per-target results found in ${targetsDir}`);
    process.exitCode = 1;
    return;
  }

  const report = buildDeploymentReport(results);

  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify(report, null, 2));

  console.log(`[cloud-report] ${report.timestamp}`);
  for (const t of report.targets) {
    console.log(`[cloud-report]   ${t.target}: ${t.status}`);
    for (const v of t.boundViolations ?? []) console.log(`[cloud-report]     bound exceeded: ${v}`);
  }
  console.log(`[cloud-report] report: ${outPath}`);

  const allVerified = report.targets.every((t) => t.status === 'VERIFIED');
  process.exitCode = allVerified ? 0 : 1;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
