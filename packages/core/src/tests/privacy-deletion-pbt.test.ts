// tests/privacy-deletion-pbt.test.ts
// Property-based test for the Privacy_Controls (Phase 9, Requirement 10).
//
// Feature: consumer-platform-security, Property 21 — Deletion removes all
// personal data.
// Validates: Requirements 10.2
//
// This file proves, across arbitrary users and arbitrary personal data seeded
// across several registered data sources, that once an account-deletion request
// completes for a user, every registered source returns no personal data for
// that user (R10.2):
//   - `PrivacyControls.deleteAccount(user)` fans out `erase(user)` to every
//     registered `PersonalDataSource`, and
//   - afterwards `exportData(user)` (which fans out `collect(user)` to the same
//     sources) yields an empty package for that user — no source leaks residual
//     personal data.
//
// To exercise the fan-out densely the test uses an in-memory data source backed
// by a per-(source,user) record map. Several such sources are registered, each
// seeded with data for a shared, small user-id space so users collide across
// sources and deletion must clear every source. A cross-user check makes the
// "scoped to the deleted user" half explicit: deleting one user must not erase
// any other user's data.
//
// Kept in its own *-pbt.test.ts file per the repo convention so the universal
// property is exercised across many generated inputs.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';

import { PrivacyControls, type PersonalDataSource } from '../security/privacy.js';

const NUM_RUNS = 200;

// Small, fixed user id space so seeded data collides across sources and the
// deletion fan-out is exercised densely rather than over a sparse id space.
const USERS = ['u0', 'u1', 'u2', 'u3', 'u4'] as const;
type UserId = (typeof USERS)[number];

const userArb = fc.constantFrom(...USERS);

/**
 * An in-memory {@link PersonalDataSource} that stores an arbitrary record per
 * user. `collect` returns a copy of the user's record (or an empty object once
 * erased), and `erase` removes the user's record entirely.
 */
class MemorySource implements PersonalDataSource {
  readonly name: string;
  private readonly data = new Map<string, Record<string, unknown>>();

  constructor(name: string) {
    this.name = name;
  }

  seed(userId: string, record: Record<string, unknown>): void {
    this.data.set(userId, { ...record });
  }

  async collect(userId: string): Promise<Record<string, unknown>> {
    const record = this.data.get(userId);
    return record ? { ...record } : {};
  }

  async erase(userId: string): Promise<void> {
    this.data.delete(userId);
  }
}

// A seeding entry: which source index, which user, and a payload field/value.
const seedArb = fc.record({
  sourceIndex: fc.integer({ min: 0, max: 2 }),
  userId: userArb,
  field: fc.string({ minLength: 1, maxLength: 8 }),
  value: fc.oneof(fc.string(), fc.integer(), fc.boolean()),
});

const seedsArb = fc.array(seedArb, { maxLength: 30 });

/** True when an export package holds no personal data for the user. */
function isEmptyPackage(pkg: Record<string, unknown>): boolean {
  return Object.values(pkg).every(
    (domain) =>
      domain != null &&
      typeof domain === 'object' &&
      Object.keys(domain as Record<string, unknown>).length === 0,
  );
}

// ── Property 21: deletion removes all personal data (R10.2) ─────────────────────

// Feature: consumer-platform-security, Property 21: Deletion removes all personal data
// Validates: Requirements 10.2
describe('Property 21: deletion removes all personal data', () => {
  it('removes a deleted user from every registered source so exportData returns nothing (R10.2)', async () => {
    await fc.assert(
      fc.asyncProperty(seedsArb, userArb, async (seeds, target) => {
        const sources = [
          new MemorySource('profiles'),
          new MemorySource('messages'),
          new MemorySource('activity'),
        ];
        const controls = new PrivacyControls();
        for (const source of sources) controls.registerSource(source);

        // Seed arbitrary personal data across sources/users.
        for (const seed of seeds) {
          sources[seed.sourceIndex].seed(seed.userId, { [seed.field]: seed.value });
        }

        await controls.deleteAccount(target);

        // After deletion, the target's export package must hold no personal
        // data in ANY source.
        const pkg = await controls.exportData(target);
        assert.ok(
          isEmptyPackage(pkg),
          `expected empty export for deleted user ${target}, got ${JSON.stringify(pkg)}`,
        );

        // Each source individually returns nothing for the deleted user.
        for (const source of sources) {
          const collected = await source.collect(target);
          assert.deepEqual(collected, {});
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('only erases the deleted user, preserving every other user\'s data (R10.2)', async () => {
    await fc.assert(
      fc.asyncProperty(seedsArb, userArb, async (seeds, target) => {
        const sources = [
          new MemorySource('profiles'),
          new MemorySource('messages'),
          new MemorySource('activity'),
        ];
        const controls = new PrivacyControls();
        for (const source of sources) controls.registerSource(source);

        for (const seed of seeds) {
          sources[seed.sourceIndex].seed(seed.userId, { [seed.field]: seed.value });
        }

        // Ground truth: the latest seeded record per (source, user) before
        // deletion. Later seeds for the same (source, user) replace earlier ones,
        // matching MemorySource.seed semantics.
        const expectedBefore = new Map<string, Record<string, unknown>>();
        for (const seed of seeds) {
          expectedBefore.set(`${seed.sourceIndex}\u0000${seed.userId}`, {
            [seed.field]: seed.value,
          });
        }

        await controls.deleteAccount(target);

        for (let i = 0; i < sources.length; i++) {
          for (const user of USERS) {
            const collected = await sources[i].collect(user);
            if (user === target) {
              assert.deepEqual(collected, {}, `deleted user ${user} should be empty`);
            } else {
              const expected = expectedBefore.get(`${i}\u0000${user}`) ?? {};
              assert.deepEqual(
                collected,
                expected,
                `non-deleted user ${user} in source ${i} must be unchanged`,
              );
            }
          }
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
