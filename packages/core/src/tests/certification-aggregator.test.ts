// tests/certification-aggregator.test.ts
// Integration tests for the Consumer-Platform Certification scorecard
// (Requirements 12.1, 12.2, 12.3, 12.4). `computeCertification()` derives the
// eight-category scorecard SOLELY from recorded Verification Artifacts.
//
// Covered here, over crafted artifact sets:
//  - report shape — a status entry for each of the eight categories, in order (Req 12.1)
//  - category status — fully certified iff every contributing capability is VERIFIED (Req 12.2)
//  - unverified list — a contributing capability with NO artifact is treated as not
//    VERIFIED, surfaces with hasArtifact=false, and the category is not fully certified (Req 12.3)
//  - unverified list — a contributing capability with a non-VERIFIED artifact surfaces too (Req 12.3)
//  - provenance — `computedFrom` references the supplied evidence paths (Req 12.4)
//  - timestamp — ISO-8601, deterministic under an injected clock (Req 12.4)
//
// All checks run offline — no credentials, no network.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  computeCertification,
  CONSUMER_PLATFORM_CAPABILITIES,
  REPORT_CATEGORIES,
  type CategoryStatus,
  type CertificationReport,
} from '../verification/certification.js';
import type { ArtifactSource } from '../verification/aggregator.js';
import type { VerificationArtifact } from '../verification/artifact.js';
import type { VerificationStatus } from '../verification/status.js';

// ── Fixtures ───────────────────────────────────────────────────────────────────

function artifact(
  capabilityId: string,
  status: VerificationStatus,
): VerificationArtifact {
  return {
    schemaVersion: 1,
    capabilityId,
    status,
    evidence: {
      sourceCode: status === 'VERIFIED',
      passingTests: status === 'VERIFIED',
      documentation: status === 'VERIFIED',
      artifact: status === 'VERIFIED',
    },
    command: `verify ${capabilityId}`,
    exitCode: status === 'VERIFIED' ? 0 : 1,
    timestamp: '2025-01-01T00:00:00.000Z',
    generator: { tool: 'test', version: '1.0.0' },
    ...(status === 'BLOCKED'
      ? { blockedReason: { missingPrerequisite: 'svc', kind: 'service' as const } }
      : {}),
  };
}

/** A full set of VERIFIED artifacts for every consumer-platform capability. */
function allVerified(): VerificationArtifact[] {
  return CONSUMER_PLATFORM_CAPABILITIES.map((id) => artifact(id, 'VERIFIED'));
}

/** Paired artifact + provenance path for every capability, all VERIFIED. */
function allVerifiedSources(): ArtifactSource[] {
  return CONSUMER_PLATFORM_CAPABILITIES.map((id) => ({
    artifact: artifact(id, 'VERIFIED'),
    path: `verification-artifacts/${id}.artifact.json`,
  }));
}

function category(report: CertificationReport, name: string): CategoryStatus {
  const entry = report.categories.find((c) => c.category === name);
  assert.ok(entry, `expected a status entry for category ${name}`);
  return entry;
}

const ISO_8601 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

// ── Report shape (Req 12.1) ─────────────────────────────────────────────────────

describe('computeCertification — report shape (Req 12.1)', () => {
  it('reports a status entry for each of the eight categories, in order', () => {
    const report = computeCertification(allVerified());
    assert.equal(report.categories.length, REPORT_CATEGORIES.length);
    assert.deepEqual(
      report.categories.map((c) => c.category),
      [...REPORT_CATEGORIES],
    );
    assert.deepEqual(
      report.categories.map((c) => c.category),
      [
        'Security',
        'Privacy',
        'Abuse Prevention',
        'Authentication',
        'Moderation',
        'Developer Experience',
        'Enterprise Readiness',
        'Production Readiness',
      ],
    );
  });

  it('lists at least one contributing capability for every category', () => {
    const report = computeCertification(allVerified());
    for (const cat of report.categories) {
      assert.ok(
        cat.contributing.length > 0,
        `category ${cat.category} should have contributing capabilities`,
      );
    }
  });
});

// ── Category status derivation (Req 12.2) ───────────────────────────────────────

describe('computeCertification — category status from VERIFIED contributors (Req 12.2)', () => {
  it('marks every category fully certified when all contributors are VERIFIED', () => {
    const report = computeCertification(allVerified());
    for (const cat of report.categories) {
      assert.equal(
        cat.fullyCertified,
        true,
        `category ${cat.category} should be fully certified`,
      );
      assert.equal(cat.unverified.length, 0);
      assert.ok(
        cat.contributing.every((c) => c.status === 'VERIFIED' && c.hasArtifact),
      );
    }
  });

  it('does not fully certify a category when a contributor is non-VERIFIED (Req 12.3)', () => {
    // moderation.toolkit contributes only to the Moderation category, so demoting
    // it isolates the effect to that one category.
    const artifacts = allVerified().map((a) =>
      a.capabilityId === 'moderation.toolkit'
        ? artifact('moderation.toolkit', 'PARTIAL')
        : a,
    );

    const report = computeCertification(artifacts);
    const moderation = category(report, 'Moderation');

    assert.equal(moderation.fullyCertified, false);
    const offending = moderation.unverified.find(
      (c) => c.capabilityId === 'moderation.toolkit',
    );
    assert.ok(offending, 'demoted capability should appear in unverified');
    assert.equal(offending.status, 'PARTIAL');
    assert.equal(offending.hasArtifact, true);
  });
});

// ── Unverified list when a contributing capability has no artifact (Req 12.3) ────

describe('computeCertification — missing-artifact handling (Req 12.3)', () => {
  it('treats a contributor with no artifact as not VERIFIED and lists it as unverified', () => {
    // Provide every capability EXCEPT moderation.toolkit (a Moderation contributor).
    const artifacts = allVerified().filter(
      (a) => a.capabilityId !== 'moderation.toolkit',
    );

    const report = computeCertification(artifacts);
    const moderation = category(report, 'Moderation');

    assert.equal(moderation.fullyCertified, false);

    // The missing capability still appears among the contributors...
    const missing = moderation.contributing.find(
      (c) => c.capabilityId === 'moderation.toolkit',
    );
    assert.ok(missing, 'a missing contributor must still be listed as contributing');
    assert.equal(missing.hasArtifact, false);
    assert.notEqual(missing.status, 'VERIFIED');

    // ...and is surfaced in the unverified list with hasArtifact=false.
    assert.ok(
      moderation.unverified.some(
        (c) => c.capabilityId === 'moderation.toolkit' && !c.hasArtifact,
      ),
    );
  });

  it('propagates a missing shared contributor to every category it feeds', () => {
    // encryption.field contributes to Security, Privacy, and Enterprise Readiness.
    const artifacts = allVerified().filter(
      (a) => a.capabilityId !== 'encryption.field',
    );
    const report = computeCertification(artifacts);

    for (const name of ['Security', 'Privacy', 'Enterprise Readiness']) {
      const cat = category(report, name);
      assert.equal(cat.fullyCertified, false, `${name} should not be fully certified`);
      assert.ok(
        cat.unverified.some(
          (c) => c.capabilityId === 'encryption.field' && !c.hasArtifact,
        ),
        `${name} should list encryption.field as unverified`,
      );
    }

    // A category that does NOT depend on encryption.field stays fully certified.
    const moderation = category(report, 'Moderation');
    assert.equal(moderation.fullyCertified, true);
  });

  it('reports every category as not fully certified when no artifacts are supplied', () => {
    const report = computeCertification([]);
    for (const cat of report.categories) {
      assert.equal(cat.fullyCertified, false);
      assert.ok(cat.unverified.length > 0);
      assert.ok(cat.unverified.every((c) => !c.hasArtifact));
      assert.ok(cat.unverified.every((c) => c.status === 'NOT_IMPLEMENTED'));
    }
    assert.deepEqual(report.computedFrom, []);
  });
});

// ── Provenance + timestamp (Req 12.4) ───────────────────────────────────────────

describe('computeCertification — provenance and timestamp (Req 12.4)', () => {
  it('references the supplied evidence paths in computedFrom', () => {
    const sources = allVerifiedSources();
    const report = computeCertification(sources);

    assert.equal(report.computedFrom.length, sources.length);
    assert.deepEqual(report.computedFrom, sources.map((s) => s.path));
    assert.ok(report.computedFrom.every((p) => p.endsWith('.artifact.json')));
  });

  it('records only paths that were actually provided', () => {
    // Mix sources with paths and bare artifacts (no path) — only paths surface.
    const withPath: ArtifactSource[] = [
      {
        artifact: artifact('moderation.toolkit', 'VERIFIED'),
        path: 'verification-artifacts/moderation.toolkit.artifact.json',
      },
    ];
    const bare: VerificationArtifact[] = [artifact('privacy.controls', 'VERIFIED')];

    const report = computeCertification([...withPath, ...bare]);
    assert.deepEqual(report.computedFrom, [
      'verification-artifacts/moderation.toolkit.artifact.json',
    ]);
  });

  it('emits an ISO-8601 timestamp and is deterministic under an injected clock', () => {
    const clock = new Date('2025-06-01T12:00:00.000Z');
    const report = computeCertification(allVerified(), clock);
    assert.match(report.timestamp, ISO_8601);
    assert.equal(report.timestamp, '2025-06-01T12:00:00.000Z');

    const again = computeCertification(allVerified(), clock);
    assert.deepEqual(report, again);
  });
});
