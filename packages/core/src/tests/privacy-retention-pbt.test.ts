// tests/privacy-retention-pbt.test.ts
// Property-based test for Privacy_Controls retention enforcement (Phase 9, R10).
//
// Feature: consumer-platform-security, Property 22 — Retention enforcement
// removes exactly expired records.
// Validates: Requirements 10.3, 10.4
//
// R10.3: "THE Privacy_Controls SHALL apply a configured retention policy that
// removes records once they exceed their configured retention period."
// R10.4: "WHEN a retention period for a record elapses, THE Privacy_Controls
// SHALL remove that record on the next retention enforcement cycle."
//
// This file proves, across arbitrary record sets, retention policies, and
// enforcement clock values, that a single `enforceRetention(now)` cycle removes
// EXACTLY the expired records and nothing else:
//   - a record is removed iff a policy exists for its type AND its age
//     (`now - createdAt`) strictly exceeds that policy's `maxAgeMs`,
//   - records of a type with no configured policy are always retained,
//   - records whose age has not yet exceeded their policy are retained,
//   - the reported `removed` count equals the number of records actually gone,
//   - enforcement is idempotent: a second cycle at the same `now` removes none.
//
// Timing is fully deterministic via an injected clock; the controls are driven
// over the real InMemoryRetentionStore so the property exercises the genuine
// retention logic with no mocks. Kept in its own *-pbt.test.ts file per the
// repo convention, ≥100 runs.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';

import {
  PrivacyControls,
  InMemoryRetentionStore,
  type RetentionPolicy,
  type RetainableRecord,
} from '../security/privacy.js';

const NUM_RUNS = 200;

// The clock value at which enforcement runs. All generated record ages are
// expressed relative to this fixed "now" so window timing is deterministic.
const NOW = 10_000_000;

// A small, fixed type space so policies and records collide densely, exercising
// both the "has policy" and "no policy" branches across runs.
const TYPES = ['message', 'profile', 'session', 'log', 'audit'] as const;
type RecordType = (typeof TYPES)[number];

const typeArb = fc.constantFrom(...TYPES);

// A retention policy per type: each generated policy picks a maxAgeMs. The set
// of typed policies is built from a subset of TYPES so some types are
// deliberately left un-governed (and thus never removed).
const policiesArb: fc.Arbitrary<RetentionPolicy[]> = fc
  .uniqueArray(typeArb, { maxLength: TYPES.length })
  .chain((types) =>
    fc
      .tuple(...types.map(() => fc.integer({ min: 1, max: 1_000_000 })))
      .map((ages) =>
        types.map((recordType, i) => ({ recordType, maxAgeMs: ages[i] as number })),
      ),
  );

// A record carries a type and a createdAt expressed as an age before NOW. Ages
// span well below, at, and above any policy bound so the boundary (age ==
// maxAgeMs, which must be RETAINED) is exercised. Unique ids are assigned after
// generation so records never collide in the store.
const recordsArb: fc.Arbitrary<RetainableRecord[]> = fc
  .array(
    fc.record({
      type: typeArb,
      age: fc.integer({ min: 0, max: 1_500_000 }),
    }),
    { maxLength: 40 },
  )
  .map((raw) =>
    raw.map((r, i) => ({
      type: r.type,
      id: `rec-${i}`,
      createdAt: NOW - r.age,
    })),
  );

// ── Property 22: retention removes exactly expired records (R10.3/R10.4) ─────────

// Feature: consumer-platform-security, Property 22: Retention enforcement
// removes exactly expired records
// Validates: Requirements 10.3, 10.4
describe('Property 22: retention enforcement removes exactly expired records', () => {
  it('removes a record iff a policy exists and its age strictly exceeds maxAgeMs, retaining all others (R10.3/R10.4)', async () => {
    await fc.assert(
      fc.asyncProperty(policiesArb, recordsArb, async (policies, records) => {
        const store = new InMemoryRetentionStore();
        for (const record of records) store.add(record);

        // Inject a fixed clock so enforceRetention() with no argument uses NOW.
        const privacy = new PrivacyControls({
          policies,
          retentionStore: store,
          clock: () => NOW,
        });

        const policyByType = new Map(policies.map((p) => [p.recordType, p]));

        // Ground-truth expiry predicate derived directly from the spec contract:
        // expired iff a policy governs the type AND age strictly exceeds maxAge.
        const isExpired = (record: RetainableRecord): boolean => {
          const policy = policyByType.get(record.type as RecordType);
          if (!policy) return false;
          return NOW - record.createdAt > policy.maxAgeMs;
        };

        const expectedRemoved = records.filter(isExpired);
        const expectedRetained = records.filter((r) => !isExpired(r));

        const { removed } = await privacy.enforceRetention();

        // The reported count equals the number of genuinely expired records.
        assert.equal(removed, expectedRemoved.length, 'reported removed count must equal expired records');

        // The store retains exactly the non-expired records — no over-removal,
        // no leaked-expired records.
        const remaining = await store.list();
        const remainingKeys = new Set(remaining.map((r) => `${r.type}\u0000${r.id}`));

        assert.equal(remainingKeys.size, expectedRetained.length, 'exactly the non-expired records must remain');
        for (const record of expectedRetained) {
          assert.ok(
            remainingKeys.has(`${record.type}\u0000${record.id}`),
            `non-expired record ${record.type}/${record.id} must be retained`,
          );
        }
        for (const record of expectedRemoved) {
          assert.ok(
            !remainingKeys.has(`${record.type}\u0000${record.id}`),
            `expired record ${record.type}/${record.id} must be removed`,
          );
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('is idempotent: a second cycle at the same clock removes nothing further (R10.4)', async () => {
    await fc.assert(
      fc.asyncProperty(policiesArb, recordsArb, async (policies, records) => {
        const store = new InMemoryRetentionStore();
        for (const record of records) store.add(record);

        const privacy = new PrivacyControls({
          policies,
          retentionStore: store,
          clock: () => NOW,
        });

        const first = await privacy.enforceRetention();
        const afterFirst = (await store.list()).length;

        // A second enforcement cycle at the same "now" must be a no-op: every
        // expired record was already removed in the first cycle.
        const second = await privacy.enforceRetention();
        const afterSecond = (await store.list()).length;

        assert.equal(second.removed, 0, 'a repeated cycle at the same clock removes nothing');
        assert.equal(afterSecond, afterFirst, 'record set is stable after the first cycle');
        // Sanity: the first cycle accounted for every record it claimed.
        assert.equal(afterFirst, records.length - first.removed, 'first cycle removed exactly its reported count');
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('removes records governed by a policy as soon as the next cycle runs after the period elapses (R10.4)', async () => {
    // Drive a single record across the boundary of its policy: at age ==
    // maxAgeMs it is retained; at the next cycle one ms later (age > maxAgeMs)
    // it is removed — proving removal happens on the next cycle after elapse.
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 1_000_000 }),
        async (maxAgeMs) => {
          const createdAt = 0;
          const store = new InMemoryRetentionStore();
          store.add({ type: 'message', id: 'only', createdAt });

          let clockNow = createdAt + maxAgeMs; // age == maxAgeMs (boundary)
          const privacy = new PrivacyControls({
            policies: [{ recordType: 'message', maxAgeMs }],
            retentionStore: store,
            clock: () => clockNow,
          });

          // At exactly the retention period, the record has not yet *exceeded*
          // it, so it is retained.
          const atBoundary = await privacy.enforceRetention();
          assert.equal(atBoundary.removed, 0, 'record at age == maxAgeMs must be retained');
          assert.equal((await store.list()).length, 1, 'boundary record still present');

          // One cycle later, the period has elapsed and the record is removed.
          clockNow = createdAt + maxAgeMs + 1;
          const afterElapse = await privacy.enforceRetention();
          assert.equal(afterElapse.removed, 1, 'record must be removed on the cycle after the period elapses');
          assert.equal((await store.list()).length, 0, 'expired record removed');
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });
});
