import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';

import {
  computeLeadership,
  PLATFORM_LEADERSHIP_CAPABILITIES,
  type ArtifactSource,
} from '../src/verification/aggregator.js';
import { validateArtifact, type VerificationArtifact } from '../src/verification/artifact.js';
import type { VerificationStatus } from '../src/verification/status.js';

// Layer A — pure decision-logic property test for the Platform Leadership
// exit-criteria aggregator. This NEVER raises a capability to VERIFIED in
// production; it only verifies that `computeLeadership` derives its decision
// SOLELY from the recorded artifacts.

const REQUIRED = PLATFORM_LEADERSHIP_CAPABILITIES;
const FOUR_STATUSES: readonly VerificationStatus[] = [
  'VERIFIED',
  'PARTIAL',
  'BLOCKED',
  'NOT_IMPLEMENTED',
];

// A fixed clock so the report's timestamp is deterministic across runs.
const FIXED_NOW = new Date('2024-01-01T00:00:00.000Z');

/**
 * Build a schema-valid Verification Artifact for a given capability + status.
 * The `seed` perturbs the timestamp so duplicate-capability artifacts differ.
 */
function makeArtifact(
  capabilityId: string,
  status: VerificationStatus,
  seed = 0,
): VerificationArtifact {
  const artifact: VerificationArtifact = {
    schemaVersion: 1,
    capabilityId,
    status,
    evidence: {
      sourceCode: true,
      passingTests: status === 'VERIFIED',
      documentation: true,
      artifact: true,
    },
    command: `street verify ${capabilityId}`,
    exitCode: status === 'VERIFIED' ? 0 : 1,
    timestamp: new Date(1_700_000_000_000 + seed).toISOString(),
    durationMs: 1,
    timedOut: false,
    generator: { tool: 'command-runner', version: '1.0.0' },
  };
  if (status === 'BLOCKED') {
    artifact.blockedReason = { missingPrerequisite: 'external-service', kind: 'service' };
  }
  return artifact;
}

// Per-capability spec: either no artifact at all ('missing') or one of the
// four recorded statuses. This spans "all status combinations and missing
// entries" required by the task's generator.
type CapSpec = 'missing' | VerificationStatus;
const capSpecArb: fc.Arbitrary<CapSpec> = fc.constantFrom<CapSpec>(
  'missing',
  'VERIFIED',
  'PARTIAL',
  'BLOCKED',
  'NOT_IMPLEMENTED',
);

// One spec per required capability (exact length, positionally aligned).
const specsArb: fc.Arbitrary<CapSpec[]> = fc.array(capSpecArb, {
  minLength: REQUIRED.length,
  maxLength: REQUIRED.length,
});

// Extra, NON-required artifacts (ids never in the required set). Used to prove
// the decision ignores everything outside the required capability set.
const extraArtifactArb: fc.Arbitrary<VerificationArtifact> = fc
  .tuple(
    fc.constantFrom('extra', 'noise', 'unrelated', 'misc'),
    fc.constantFrom('alpha', 'beta', 'gamma', 'delta'),
    fc.constantFrom<VerificationStatus>(...FOUR_STATUSES),
  )
  .map(([area, cap, status]) => makeArtifact(`${area}.${cap}`, status));

const extrasArb: fc.Arbitrary<VerificationArtifact[]> = fc.array(extraArtifactArb, {
  maxLength: 6,
});

/** Build the required-capability artifacts from a per-capability spec list. */
function artifactsFromSpecs(specs: CapSpec[]): VerificationArtifact[] {
  const out: VerificationArtifact[] = [];
  REQUIRED.forEach((capabilityId, i) => {
    const spec = specs[i]!;
    if (spec !== 'missing') {
      out.push(makeArtifact(capabilityId, spec));
    }
  });
  return out;
}

/**
 * Independent reference: the decision is GRANTED iff every required capability
 * is present (not 'missing') AND its recorded status is exactly VERIFIED. This
 * mirrors Req 12.1/12.3 without copying the implementation's control flow.
 */
function expectedGranted(specs: CapSpec[]): boolean {
  return specs.every((s) => s === 'VERIFIED');
}

// Feature: platform-leadership-gaps, Property 31: The Platform Leadership decision is computed only from artifacts
// Validates: Requirements 12.1, 12.2, 12.3, 12.4
describe('Property 31: the Platform Leadership decision is computed only from artifacts', () => {
  it('generated artifacts are schema-valid (generator sanity)', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...REQUIRED),
        fc.constantFrom<VerificationStatus>(...FOUR_STATUSES),
        (capabilityId, status) => {
          const { valid, errors } = validateArtifact(makeArtifact(capabilityId, status));
          assert.ok(valid, `artifact must be schema-valid: ${errors.join('; ')}`);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('GRANTED iff every required capability has a recorded VERIFIED artifact (Req 12.1/12.3)', () => {
    fc.assert(
      fc.property(specsArb, (specs) => {
        const report = computeLeadership(artifactsFromSpecs(specs), FIXED_NOW);
        assert.equal(report.decision === 'GRANTED', expectedGranted(specs));
      }),
      { numRuns: 300 },
    );
  });

  it('reports every required capability with the correct status and hasArtifact flag (Req 12.3)', () => {
    fc.assert(
      fc.property(specsArb, (specs) => {
        const report = computeLeadership(artifactsFromSpecs(specs), FIXED_NOW);

        // The required list mirrors the fixed capability set, in order.
        assert.deepEqual(
          report.required.map((r) => r.capabilityId),
          [...REQUIRED],
        );

        report.required.forEach((entry, i) => {
          const spec = specs[i]!;
          if (spec === 'missing') {
            // A missing artifact is treated as not VERIFIED (Req 12.3): no
            // artifact recorded, and the faithful NOT_IMPLEMENTED status.
            assert.equal(entry.hasArtifact, false);
            assert.equal(entry.status, 'NOT_IMPLEMENTED');
          } else {
            assert.equal(entry.hasArtifact, true);
            assert.equal(entry.status, spec);
          }
        });
      }),
      { numRuns: 300 },
    );
  });

  it('WITHHELD lists exactly the required capabilities that are non-VERIFIED or missing (Req 12.2)', () => {
    fc.assert(
      fc.property(specsArb, (specs) => {
        const report = computeLeadership(artifactsFromSpecs(specs), FIXED_NOW);

        const expectedWithheld = REQUIRED.filter(
          (_id, i) => specs[i] !== 'VERIFIED',
        );

        assert.deepEqual(
          report.withheld.map((w) => w.capabilityId),
          expectedWithheld,
        );

        // Decision and withheld set are consistent: WITHHELD iff non-empty.
        assert.equal(report.decision === 'WITHHELD', report.withheld.length > 0);
        assert.equal(report.decision === 'GRANTED', report.withheld.length === 0);

        // Every withheld entry is genuinely not VERIFIED.
        for (const w of report.withheld) {
          assert.notEqual(w.status, 'VERIFIED');
        }
      }),
      { numRuns: 300 },
    );
  });

  it('the decision depends ONLY on required artifacts; extra unrelated artifacts never change it (Req 12.4)', () => {
    fc.assert(
      fc.property(specsArb, extrasArb, (specs, extras) => {
        const required = artifactsFromSpecs(specs);
        const baseline = computeLeadership(required, FIXED_NOW);

        // Interleave extra, non-required artifacts in arbitrary positions.
        const withExtras = [...extras, ...required, ...extras];
        const augmented = computeLeadership(withExtras, FIXED_NOW);

        assert.equal(augmented.decision, baseline.decision);
        assert.deepEqual(augmented.required, baseline.required);
        assert.deepEqual(augmented.withheld, baseline.withheld);
      }),
      { numRuns: 300 },
    );
  });

  it('the decision is independent of artifact ordering (Req 12.4)', () => {
    fc.assert(
      fc.property(specsArb, fc.integer(), (specs, seed) => {
        const artifacts = artifactsFromSpecs(specs);

        // A deterministic shuffle driven by the generated seed.
        const shuffled = [...artifacts]
          .map((a, i) => ({ a, k: (i + 1) * (seed % 97 || 1) }))
          .sort((x, y) => x.k - y.k)
          .map((e) => e.a);

        const original = computeLeadership(artifacts, FIXED_NOW);
        const reordered = computeLeadership(shuffled, FIXED_NOW);

        assert.equal(reordered.decision, original.decision);
        assert.deepEqual(reordered.required, original.required);
        assert.deepEqual(reordered.withheld, original.withheld);
      }),
      { numRuns: 200 },
    );
  });

  it('records provenance paths for ArtifactSource inputs without affecting the decision (Req 12.4)', () => {
    fc.assert(
      fc.property(specsArb, (specs) => {
        const required = artifactsFromSpecs(specs);
        const sources: ArtifactSource[] = required.map((artifact) => ({
          artifact,
          path: `verification-artifacts/${artifact.capabilityId}.artifact.json`,
        }));

        const fromArtifacts = computeLeadership(required, FIXED_NOW);
        const fromSources = computeLeadership(sources, FIXED_NOW);

        // Same decision regardless of whether paths are supplied.
        assert.equal(fromSources.decision, fromArtifacts.decision);
        assert.deepEqual(fromSources.required, fromArtifacts.required);

        // Provenance is recorded for every supplied path.
        assert.deepEqual(
          fromSources.computedFrom,
          required.map((a) => `verification-artifacts/${a.capabilityId}.artifact.json`),
        );
      }),
      { numRuns: 200 },
    );
  });
});
