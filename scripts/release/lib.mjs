// scripts/release/lib.mjs
//
// Pure helpers for the Release Engineering report renderer (Requirement 11).
// These functions hold the renderer's decision and presentation logic so they
// can be unit-tested directly without spawning a process or touching disk. They
// build on the zero-dependency core primitives (`buildReleaseReport`,
// `isValidSemver`, `validateReleaseNotes`) — the renderer never reimplements
// validation or scoring, it only *enforces* the controls and renders the report.
//
// Two control families are enforced (Req 11.6):
//   - Validation controls (Req 11.2/11.3): the changelog version is valid semver
//     and the release notes contain a non-empty entry for that version.
//   - Scorecard controls (Req 11.1/11.6): every scored dimension meets its
//     minimum enforced threshold.
//
// When any enforced control is unsatisfied the renderer exits non-zero so CI
// fails the release WITHOUT publishing (Req 11.3/11.6).
//
// Node core only (lives under scripts/release where deps are permitted, but
// none are needed here).

/** The four scored release dimensions, each on a 0–100 scale (Req 11.1). */
export const RELEASE_DIMENSIONS = Object.freeze([
  'security',
  'reliability',
  'coverage',
  'performance',
]);

/**
 * Default minimum enforced score per dimension (Req 11.6). A release whose
 * security/reliability/coverage/performance score falls below this bar fails the
 * enforced scorecard control. Overridable per-dimension via inputs/flags/env.
 */
export const DEFAULT_MIN_SCORE = 80;

/** Parse `--flag value` / `--flag` style options from an argv slice. */
export function parseFlags(argv) {
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) {
        flags[key] = true;
      } else {
        flags[key] = next;
        i++;
      }
    }
  }
  return flags;
}

/**
 * Resolve the per-dimension minimum thresholds. Precedence (lowest first):
 * {@link DEFAULT_MIN_SCORE} → a uniform `RELEASE_MIN_SCORE` env override →
 * `inputs.thresholds.<dim>` → `--min-<dim>` flag. Non-numeric values are ignored
 * so a malformed override can never silently weaken the bar.
 */
export function resolveThresholds(inputs = {}, flags = {}, env = {}) {
  const base = (() => {
    const fromEnv = Number(env.RELEASE_MIN_SCORE);
    return Number.isFinite(fromEnv) ? fromEnv : DEFAULT_MIN_SCORE;
  })();

  const thresholds = {};
  const fromInputs = (inputs && inputs.thresholds) || {};
  for (const dim of RELEASE_DIMENSIONS) {
    let value = base;
    if (Number.isFinite(Number(fromInputs[dim]))) value = Number(fromInputs[dim]);
    const flagVal = Number(flags[`min-${dim}`]);
    if (Number.isFinite(flagVal)) value = flagVal;
    thresholds[dim] = value;
  }
  return thresholds;
}

/**
 * Evaluate every enforced control against a built {@link ReleaseReport}.
 *
 * Returns `{ passed, controls, failedControls }`:
 *  - `controls` is the ordered list of `{ name, ok, detail }` for every checked
 *    control (validation first, then each scorecard dimension).
 *  - `failedControls` lists the names of controls that are not satisfied.
 *  - `passed` is true iff `failedControls` is empty.
 *
 * The validation outcomes come straight from `report.validation` (produced by
 * the core `buildReleaseReport`), so this function never re-derives semver or
 * release-notes correctness — it only surfaces and enforces them (Req 11.3).
 */
export function evaluateControls(report, thresholds) {
  const controls = [];

  controls.push({
    name: 'semver',
    ok: report.validation.semverOk === true,
    detail: report.validation.semverOk
      ? `version '${report.version}' is valid semver MAJOR.MINOR.PATCH`
      : `version '${report.version}' is not valid semver MAJOR.MINOR.PATCH`,
  });

  controls.push({
    name: 'release-notes',
    ok: report.validation.releaseNotesOk === true,
    detail: report.validation.releaseNotesOk
      ? `changelog has a non-empty entry for '${report.version}'`
      : `changelog has no non-empty entry for '${report.version}'`,
  });

  for (const dim of RELEASE_DIMENSIONS) {
    const score = report.scorecard[dim];
    const min = thresholds[dim];
    const ok = typeof score === 'number' && score >= min;
    controls.push({
      name: `scorecard:${dim}`,
      ok,
      detail: ok
        ? `${dim} score ${score} ≥ minimum ${min}`
        : `${dim} score ${score} < minimum ${min}`,
    });
  }

  const failedControls = controls.filter((c) => !c.ok).map((c) => c.name);
  return { passed: failedControls.length === 0, controls, failedControls };
}

/** Format a single health metric line: `count (Δ +n vs previous)`. */
function formatHealth(metric) {
  const delta = metric.deltaVsPrevious;
  const sign = delta > 0 ? '+' : '';
  return `${metric.count} (Δ ${sign}${delta} vs previous)`;
}

/**
 * Render the release report as Markdown for human review. Pure: identical input
 * yields identical output. Includes the scorecard, the validation results, the
 * health metrics, and the enforced-control outcomes (Req 11.5).
 */
export function renderMarkdown(report, controlsResult) {
  const lines = [];
  const decision = controlsResult.passed ? '✅ PASS' : '❌ FAIL';

  lines.push(`# Release Report — ${report.version}`);
  lines.push('');
  lines.push(`- **Enforcement:** ${decision}`);
  lines.push(`- **Timestamp:** ${report.timestamp}`);
  if (!controlsResult.passed) {
    lines.push(`- **Failed controls:** ${controlsResult.failedControls.join(', ')}`);
  }
  lines.push('');

  lines.push('## Scorecard');
  lines.push('');
  lines.push('| Dimension | Score |');
  lines.push('| --- | --- |');
  for (const dim of RELEASE_DIMENSIONS) {
    lines.push(`| ${dim} | ${report.scorecard[dim]} |`);
  }
  lines.push('');

  lines.push('## Validation');
  lines.push('');
  lines.push(`- semver: ${report.validation.semverOk ? 'OK' : 'FAILED'}`);
  lines.push(`- release-notes: ${report.validation.releaseNotesOk ? 'OK' : 'FAILED'}`);
  if (report.validation.failedControl) {
    lines.push(`- first failed validation control: ${report.validation.failedControl}`);
  }
  lines.push('');

  lines.push('## Health Metrics');
  lines.push('');
  lines.push(`- dependency freshness: ${formatHealth(report.health.dependencyFreshness)}`);
  lines.push(`- test trends: ${formatHealth(report.health.testTrends)}`);
  lines.push(`- vulnerability trends: ${formatHealth(report.health.vulnerabilityTrends)}`);
  lines.push('');

  lines.push('## Enforced Controls');
  lines.push('');
  lines.push('| Control | Result | Detail |');
  lines.push('| --- | --- | --- |');
  for (const c of controlsResult.controls) {
    lines.push(`| ${c.name} | ${c.ok ? 'PASS' : 'FAIL'} | ${c.detail} |`);
  }
  lines.push('');

  return lines.join('\n');
}
