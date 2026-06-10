// tests/dast-gate-pbt.test.ts
// Property-based test for the DAST Severity Gate (Req 3.4, 3.5, 3.6).
// Kept in its own file so the universal gate property is exercised across many
// generated DastFinding[] inputs without clobbering the example/edge-case unit
// tests in dast.test.ts.
//
// The Severity Gate (evaluateDastGate) fails the build IFF at least one finding
// is at or above the configured `failOn` severity, and passes otherwise:
//   - Req 3.4: one or more High findings  -> fail
//   - Req 3.5: one or more Critical findings -> fail
//   - Req 3.6: zero High AND zero Critical findings -> pass
// The default threshold is 'high', so both High and Critical fail by default.
// A deterministic exit code accompanies the decision: 2 on fail, 0 on pass.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';

import {
  evaluateDastGate,
  buildDastArtifact,
  type DastFinding,
  type DastSeverity,
  type DastGateOptions,
} from '../security/dast.js';

const NUM_RUNS = 100;

// All five severities the DAST pipeline recognizes, lowest -> highest:
// Informational, Low, Medium, High, Critical.
const ALL_SEVERITIES: readonly DastSeverity[] = ['info', 'low', 'medium', 'high', 'critical'];

// ── Oracle ──────────────────────────────────────────────────────────────────
//
// An independent reimplementation of the documented gate contract. We keep the
// severity ordering local to this file so the property compares two expressions
// of the same spec rather than the implementation against itself.
const ORACLE_RANK: Record<DastSeverity, number> = {
  info: 0, low: 1, medium: 2, high: 3, critical: 4,
};

/** True iff at least one finding meets or exceeds the `failOn` threshold. */
function oracleShouldFail(findings: DastFinding[], failOn: DastSeverity): boolean {
  return findings.some((f) => ORACLE_RANK[f.severity] >= ORACLE_RANK[failOn]);
}

// ── Generators ────────────────────────────────────────────────────────────────
//
// A DastFinding generator spanning all five severities (uniformly, so each
// severity is sampled frequently), with arbitrary tool/name/url so the gate is
// shown to depend ONLY on severity. The array is allowed to be empty so the
// "no findings -> pass" case is exercised.
const severityArb: fc.Arbitrary<DastSeverity> = fc.constantFrom(...ALL_SEVERITIES);

const findingArb: fc.Arbitrary<DastFinding> = fc.record({
  tool: fc.constantFrom('schemathesis', 'owasp-zap', 'openapi-conformance', 'custom'),
  name: fc.string(),
  severity: severityArb,
  url: fc.option(fc.webUrl(), { nil: undefined }),
  description: fc.option(fc.string(), { nil: undefined }),
}) as fc.Arbitrary<DastFinding>;

const findingsArb: fc.Arbitrary<DastFinding[]> = fc.array(findingArb, { maxLength: 30 });

// failOn threshold: undefined exercises the default ('high'); otherwise span
// every severity so the gate is checked across all configurable thresholds.
const failOnArb: fc.Arbitrary<DastSeverity | undefined> = fc.option(severityArb, { nil: undefined });

// Feature: platform-leadership-gaps, Property 5: The DAST severity gate fails iff a finding meets the threshold
// Validates: Requirements 3.4, 3.5, 3.6
describe('Property 5: the DAST severity gate fails iff a finding meets the threshold', () => {
  it('passed is false iff some finding is at or above the configured threshold', () => {
    fc.assert(
      fc.property(findingsArb, failOnArb, (findings, failOn) => {
        const opts: DastGateOptions = failOn === undefined ? {} : { failOn };
        const result = evaluateDastGate(findings, opts);
        const effectiveFailOn = failOn ?? 'high';
        const expectedFail = oracleShouldFail(findings, effectiveFailOn);

        // Gate fails IFF a finding meets/exceeds the threshold.
        assert.equal(result.passed, !expectedFail);
        // The recorded threshold is the effective one.
        assert.equal(result.failOn, effectiveFailOn);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('default threshold fails the build for any High or Critical finding and passes otherwise (Req 3.4/3.5/3.6)', () => {
    fc.assert(
      fc.property(findingsArb, (findings) => {
        const result = evaluateDastGate(findings); // default failOn = 'high'
        const hasHigh = findings.some((f) => f.severity === 'high');
        const hasCritical = findings.some((f) => f.severity === 'critical');

        if (hasHigh || hasCritical) {
          // Req 3.4 / 3.5: High or Critical -> fail.
          assert.equal(result.passed, false);
        } else {
          // Req 3.6: zero High and zero Critical -> pass.
          assert.equal(result.passed, true);
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('exit code is deterministic: 2 on fail, 0 on pass, and every offending finding meets the threshold', () => {
    fc.assert(
      fc.property(findingsArb, failOnArb, (findings, failOn) => {
        const opts: DastGateOptions = failOn === undefined ? {} : { failOn };
        const result = evaluateDastGate(findings, opts);
        const effectiveFailOn = failOn ?? 'high';

        assert.equal(result.exitCode, result.passed ? 0 : 2);

        // The offending set is exactly the findings that meet/exceed the threshold.
        for (const f of result.offending) {
          assert.ok(ORACLE_RANK[f.severity] >= ORACLE_RANK[effectiveFailOn]);
        }
        const expectedOffending = findings.filter(
          (f) => ORACLE_RANK[f.severity] >= ORACLE_RANK[effectiveFailOn],
        );
        assert.equal(result.offending.length, expectedOffending.length);
        // passed reflects an empty offending set.
        assert.equal(result.passed, result.offending.length === 0);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('the emitted artifact records the same gate outcome as the gate itself', () => {
    fc.assert(
      fc.property(findingsArb, failOnArb, (findings, failOn) => {
        const opts: DastGateOptions = failOn === undefined ? {} : { failOn };
        const gate = evaluateDastGate(findings, opts);
        // Full coverage + no failure cause so status hinges on the gate alone.
        const artifact = buildDastArtifact(
          findings,
          { endpointsScanned: 1, endpointsTotal: 1 },
          opts,
        );
        const details = artifact.details as unknown as {
          gate: { failOn: DastSeverity; passed: boolean };
        };
        assert.equal(details.gate.passed, gate.passed);
        assert.equal(details.gate.failOn, gate.failOn);
        // A failing gate must surface a non-zero exit code on the artifact.
        assert.equal(artifact.exitCode === 0, gate.passed);
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
