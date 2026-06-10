#!/usr/bin/env node
// scripts/release/render-report.mjs
//
// Release Engineering report renderer (Requirement 11). Builds the automated
// release report by delegating to the zero-dependency core primitives, enforces
// the release controls, renders the report (JSON + Markdown), and exits with a
// non-zero status — failing the release WITHOUT publishing — when any enforced
// control is unsatisfied (Req 11.3/11.6).
//
// What it does:
//   1. Resolve the release version (--version > $RELEASE_VERSION > package.json).
//   2. Read the changelog (--changelog, default CHANGELOG.md).
//   3. Load release inputs (--inputs <file>): the raw scorecard scores and the
//      current/previous health counts. Under the zero-trust evidence standard,
//      when inputs are ABSENT the scorecard scores default to 0 (no evidence ⇒
//      no credit), which fails the enforced scorecard controls rather than
//      fabricating a passing score.
//   4. Call `buildReleaseReport()` from @streetjs/core (validates semver +
//      release notes, bounds the scorecard, computes health deltas).
//   5. Enforce the validation + scorecard controls; render JSON + Markdown.
//   6. Exit 0 when every control passes, 1 otherwise.
//
// This renderer is normally driven THROUGH the CommandRunner so the run is
// captured as the `release.scorecard` Verification Artifact (Req 11.5):
//
//   node scripts/verification/run.mjs release.scorecard --docs -- \
//     node scripts/release/render-report.mjs --inputs <inputs.json>
//
// Usage (direct):
//   node scripts/release/render-report.mjs [--version <v>] [--changelog <path>]
//     [--inputs <file>] [--out-dir <dir>] [--min-security N] [--min-reliability N]
//     [--min-coverage N] [--min-performance N]
//
// _Design: Components → Release Engineering (CI enforcement); Error Handling 11.3.
//  Requirements: 11.3, 11.5, 11.6_

import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildReleaseReport } from 'streetjs';
import {
  parseFlags,
  resolveThresholds,
  evaluateControls,
  renderMarkdown,
  RELEASE_DIMENSIONS,
} from './lib.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..', '..');

/** Zero scores: the honest default when no scorecard evidence is supplied. */
function zeroScorecard() {
  const sc = {};
  for (const dim of RELEASE_DIMENSIONS) sc[dim] = 0;
  return sc;
}

/** Zero health counts: the honest default when no health evidence is supplied. */
function zeroHealthCounts() {
  return { dependencyFreshness: 0, testTrends: 0, vulnerabilityTrends: 0 };
}

/**
 * Resolve the release version from flags, environment, then the core package
 * version. Returns the resolved string (never throws).
 */
export function resolveVersion(flags, env) {
  if (typeof flags.version === 'string') return flags.version;
  if (typeof env.RELEASE_VERSION === 'string' && env.RELEASE_VERSION.length > 0) {
    return env.RELEASE_VERSION;
  }
  try {
    const pkg = JSON.parse(
      readFileSync(join(REPO_ROOT, 'packages', 'core', 'package.json'), 'utf8'),
    );
    return pkg.version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}

/**
 * Load the release inputs file when provided. Shape:
 *   { scorecard?: {security,reliability,coverage,performance},
 *     health?: { current?: counts, previous?: counts },
 *     thresholds?: {security,reliability,coverage,performance} }
 * Missing pieces default to zero (no evidence ⇒ no credit), and a missing file
 * yields `{ present: false }` so the renderer records the absence honestly.
 */
export function loadInputs(inputsPath) {
  if (!inputsPath) return { present: false, scorecard: zeroScorecard(), health: null, raw: {} };
  const abs = resolve(inputsPath);
  if (!existsSync(abs)) {
    throw new Error(`release inputs file not found: ${abs}`);
  }
  const raw = JSON.parse(readFileSync(abs, 'utf8'));
  const scorecard = { ...zeroScorecard(), ...(raw.scorecard ?? {}) };
  const health = {
    current: { ...zeroHealthCounts(), ...((raw.health && raw.health.current) ?? {}) },
    previous: { ...zeroHealthCounts(), ...((raw.health && raw.health.previous) ?? {}) },
  };
  return { present: true, scorecard, health, raw };
}

/**
 * Pure orchestration: build the report and evaluate the controls. Exposed for
 * unit tests so the decision logic can be exercised without IO.
 */
export function buildAndEvaluate({ version, changelog, scorecard, health, thresholds, timestamp }) {
  const report = buildReleaseReport({ version, scorecard, changelog, health, timestamp });
  const controlsResult = evaluateControls(report, thresholds);
  return { report, controlsResult };
}

function main() {
  const flags = parseFlags(process.argv.slice(2));
  const env = process.env;

  const version = resolveVersion(flags, env);

  const changelogPath = resolve(
    typeof flags.changelog === 'string' ? flags.changelog : join(REPO_ROOT, 'CHANGELOG.md'),
  );
  if (!existsSync(changelogPath)) {
    console.error(`[release] changelog not found: ${changelogPath}`);
    process.exitCode = 1;
    return;
  }
  const changelog = readFileSync(changelogPath, 'utf8');

  let inputs;
  try {
    inputs = loadInputs(typeof flags.inputs === 'string' ? flags.inputs : undefined);
  } catch (err) {
    console.error(`[release] ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
    return;
  }

  const thresholds = resolveThresholds(inputs.raw, flags, env);
  const health = inputs.health ?? {
    current: zeroHealthCounts(),
    previous: zeroHealthCounts(),
  };

  const { report, controlsResult } = buildAndEvaluate({
    version,
    changelog,
    scorecard: inputs.scorecard,
    health,
    thresholds,
  });

  const outDir = resolve(
    typeof flags['out-dir'] === 'string'
      ? flags['out-dir']
      : join(REPO_ROOT, 'verification-artifacts', 'release'),
  );
  mkdirSync(outDir, { recursive: true });

  const reportPayload = {
    ...report,
    enforcement: {
      passed: controlsResult.passed,
      failedControls: controlsResult.failedControls,
      controls: controlsResult.controls,
      thresholds,
      inputsPresent: inputs.present,
    },
  };
  const jsonPath = join(outDir, 'release-report.json');
  const mdPath = join(outDir, 'release-report.md');
  writeFileSync(jsonPath, `${JSON.stringify(reportPayload, null, 2)}\n`);
  writeFileSync(mdPath, `${renderMarkdown(report, controlsResult)}\n`);

  // Operator-facing summary.
  console.log(`[release] version: ${report.version}`);
  console.log(`[release] timestamp: ${report.timestamp}`);
  if (!inputs.present) {
    console.log(
      '[release] no --inputs supplied: scorecard defaults to 0 (no evidence ⇒ no credit)',
    );
  }
  for (const c of controlsResult.controls) {
    console.log(`[release]   ${c.ok ? 'PASS' : 'FAIL'} ${c.name}: ${c.detail}`);
  }
  console.log(`[release] report: ${jsonPath}`);
  console.log(`[release] report: ${mdPath}`);

  if (!controlsResult.passed) {
    // Indicate which validation/control failed and fail the release (Req 11.3).
    console.error(
      `[release] release BLOCKED — unsatisfied controls: ${controlsResult.failedControls.join(', ')}; not publishing`,
    );
    process.exitCode = 1;
    return;
  }

  console.log('[release] all enforced controls satisfied ✔');
  process.exitCode = 0;
}

// Only run when invoked directly (not when imported by a test).
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
