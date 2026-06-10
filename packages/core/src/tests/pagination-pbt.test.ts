// tests/pagination-pbt.test.ts
// Property-based test for the Plugin Registry pagination clamping (Req 4.6).
// Kept in its own file so the universal property is exercised across many
// generated numbers without clobbering example/edge-case unit tests elsewhere.
//
// Req 4.6: the registry paginates with a DEFAULT page size of 25 and a MAXIMUM
// of 100. The pure helper normalizePageSize encodes the full documented
// contract:
//   - undefined / non-finite (NaN, +/-Infinity)  -> DEFAULT_PAGE_SIZE (25)
//   - otherwise: truncate to an integer, then clamp to [MIN, MAX] = [1, 100]
// The result is ALWAYS an integer in [1, 100].

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';

import {
  normalizePageSize,
  DEFAULT_PAGE_SIZE,
  MIN_PAGE_SIZE,
  MAX_PAGE_SIZE,
} from '../platform/plugins/pagination.js';

const NUM_RUNS = 100;

// ── Oracle ──────────────────────────────────────────────────────────────────
//
// An independent reimplementation of the documented clamping contract. We keep
// it deliberately separate from the implementation so the property compares two
// expressions of the same spec rather than the code against itself.
function expectedPageSize(requested: number | undefined): number {
  if (requested === undefined || !Number.isFinite(requested)) {
    return DEFAULT_PAGE_SIZE;
  }
  const truncated = Math.trunc(requested);
  return Math.min(MAX_PAGE_SIZE, Math.max(MIN_PAGE_SIZE, truncated));
}

// ── Generators ────────────────────────────────────────────────────────────────
//
// Cover the whole documented input space: undefined; the non-finite trio
// (NaN, +Infinity, -Infinity); arbitrary doubles incl. negatives/fractions;
// extreme magnitudes; and a dense band of small integers straddling the bounds
// so [1, 100] edges are hit frequently.
const requestedArb: fc.Arbitrary<number | undefined> = fc.oneof(
  fc.constant(undefined),
  fc.constantFrom(NaN, Infinity, -Infinity),
  fc.double({ noDefaultInfinity: false, noNaN: false }),
  fc.double({ min: -1e9, max: 1e9, noNaN: true }),
  // Dense around the [1, 100] boundaries (and just outside them).
  fc.integer({ min: -10, max: 110 }),
  fc.constantFrom(
    0,
    0.9,
    -0.9,
    1,
    1.5,
    99.9,
    100,
    100.0001,
    -0,
    Number.MAX_SAFE_INTEGER,
    Number.MIN_SAFE_INTEGER,
  ),
);

// Feature: platform-leadership-gaps, Property 12: Pagination is clamped to its bounds
// Validates: Requirements 4.6
describe('Property 12: pagination is clamped to its bounds', () => {
  it('always returns an integer within [MIN_PAGE_SIZE, MAX_PAGE_SIZE]', () => {
    fc.assert(
      fc.property(requestedArb, (requested) => {
        const result = normalizePageSize(requested);
        assert.ok(Number.isInteger(result), `result ${result} must be an integer`);
        assert.ok(
          result >= MIN_PAGE_SIZE && result <= MAX_PAGE_SIZE,
          `result ${result} must lie within [${MIN_PAGE_SIZE}, ${MAX_PAGE_SIZE}]`,
        );
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('equals the documented clamping (undefined/non-finite -> default; else truncate then clamp)', () => {
    fc.assert(
      fc.property(requestedArb, (requested) => {
        assert.equal(normalizePageSize(requested), expectedPageSize(requested));
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('maps undefined and every non-finite value to the default page size', () => {
    fc.assert(
      fc.property(
        fc.constantFrom<number | undefined>(undefined, NaN, Infinity, -Infinity),
        (requested) => {
          assert.equal(normalizePageSize(requested), DEFAULT_PAGE_SIZE);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it('clamps values at or below MIN up to MIN, and values at or above MAX down to MAX', () => {
    fc.assert(
      fc.property(
        fc.double({ min: -1e6, max: 1e6, noNaN: true }),
        (requested) => {
          const result = normalizePageSize(requested);
          if (Math.trunc(requested) <= MIN_PAGE_SIZE) {
            assert.equal(result, MIN_PAGE_SIZE);
          } else if (Math.trunc(requested) >= MAX_PAGE_SIZE) {
            assert.equal(result, MAX_PAGE_SIZE);
          } else {
            assert.equal(result, Math.trunc(requested));
          }
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });
});
