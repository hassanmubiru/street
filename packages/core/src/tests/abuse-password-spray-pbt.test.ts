// tests/abuse-password-spray-pbt.test.ts
// Property-based test for the Abuse_Engine (Phase 6, Requirement 7).
//
// Feature: consumer-platform-security, Property 17 — Password-spray
// classification.
// Validates: Requirements 7.4
//
// R7.4: "WHEN repeated failed logins across multiple accounts originate from a
// single source within the configured window, THE Abuse_Engine SHALL classify
// the activity as a password-spray pattern."
//
// This file proves, across arbitrary populations of authentication attempts
// from a single source IP, that `detectPasswordSpray` reflects the defining
// criterion exactly: the activity is classified as a spray iff the number of
// *distinct accounts* targeted by *failed* logins within the spray window
// reaches the configured `sprayDistinctAccounts` threshold. In particular:
//   - successful (non-failed) attempts never contribute to the distinct count,
//   - repeated failures against the same account count that account only once,
//   - and failures that fall outside the sliding spray window are not counted.
//
// An injected clock and explicit per-signal timestamps make all window timing
// fully deterministic; the engine is driven over the in-memory CounterStore so
// the property exercises the real sliding-window classification logic with no
// mocks. Kept in its own *-pbt.test.ts file per the repo convention, ≥100 runs.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';

import { AbuseEngine, type AbuseConfig } from '../security/abuse.js';
import { InMemoryCounterStore } from '../security/store.js';

const NUM_RUNS = 100;

// All windows share one horizon so timing reasoning stays simple; the spray
// threshold itself is varied per run to exercise both branches.
const WINDOW_MS = 600_000;
const BASE_TS = 1_000_000;
const IP = '203.0.113.7';

/**
 * Build an engine whose only behaviourally-relevant knob for this property is
 * `sprayDistinctAccounts`. Lockout / signup / score thresholds are set high
 * enough that they never interfere with spray bookkeeping, isolating R7.4.
 */
function makeEngine(sprayDistinctAccounts: number): AbuseEngine {
  const clock = () => BASE_TS;
  const cfg: AbuseConfig = {
    loginFailureThreshold: 1_000_000, // never trip a lockout during this test
    loginWindowMs: WINDOW_MS,
    lockoutMs: WINDOW_MS,
    signupThreshold: 1_000_000,
    signupWindowMs: WINDOW_MS,
    sprayDistinctAccounts,
    sprayWindowMs: WINDOW_MS,
    scoreThreshold: Number.MAX_SAFE_INTEGER, // never trip the score response
  };
  return new AbuseEngine(cfg, new InMemoryCounterStore({ clock }), undefined, { clock });
}

// ── Generators ────────────────────────────────────────────────────────────────

// A population of distinct accounts, each tagged with whether its attempts fail.
// Uniqueness is by account id so the "distinct accounts" notion is well-defined.
const attemptsArb = fc.uniqueArray(
  fc.record({ id: fc.string({ minLength: 1, maxLength: 8 }), failed: fc.boolean() }),
  { selector: (r) => r.id, minLength: 1, maxLength: 14 },
);

// How many times each account's attempt is repeated (dedup must collapse these).
const repeatsArb = fc.integer({ min: 1, max: 4 });

// Spray threshold spanning below/at/above the population sizes above.
const thresholdArb = fc.integer({ min: 2, max: 16 });

// ── Property 17: password-spray classification (R7.4) ───────────────────────────

// Feature: consumer-platform-security, Property 17: Password-spray classification
// Validates: Requirements 7.4
describe('Property 17: password-spray classification', () => {
  it('classifies as spray iff failed logins span at least the configured distinct-account threshold (R7.4)', async () => {
    await fc.assert(
      fc.asyncProperty(attemptsArb, repeatsArb, thresholdArb, async (attempts, repeats, threshold) => {
        const engine = makeEngine(threshold);

        // Record every attempt `repeats` times from the single source IP. All
        // timestamps sit inside the spray window so only the failed/distinct
        // criteria decide the outcome.
        for (const { id, failed } of attempts) {
          for (let i = 0; i < repeats; i++) {
            await engine.recordLoginAttempt({ ip: IP, accountId: id, failed, ts: BASE_TS });
          }
        }

        // The defining count: distinct accounts that had at least one *failed*
        // login — successes and repeats must not inflate it.
        const distinctFailed = attempts.filter((a) => a.failed).length;
        const expected = distinctFailed >= threshold;

        const spray = await engine.detectPasswordSpray(IP, BASE_TS);
        assert.equal(
          spray,
          expected,
          `expected spray=${expected} for ${distinctFailed} distinct failed account(s) vs threshold ${threshold}`,
        );
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('does not classify activity whose failed logins fall outside the spray window (R7.4)', async () => {
    // Even when the distinct-failed count meets the threshold, failures that
    // have aged past the sliding window must not be counted.
    const failedAccountsArb = fc.uniqueArray(fc.string({ minLength: 1, maxLength: 8 }), {
      minLength: 2,
      maxLength: 14,
    });

    await fc.assert(
      fc.asyncProperty(failedAccountsArb, async (accounts) => {
        // Threshold exactly at the population size → would classify as spray if
        // the failures were still within the window.
        const engine = makeEngine(accounts.length);

        for (const id of accounts) {
          await engine.recordLoginAttempt({ ip: IP, accountId: id, failed: true, ts: BASE_TS });
        }

        // Evaluate strictly after the window has rolled past every recorded
        // failure: now - windowMs > BASE_TS, so all events are excluded.
        const afterWindow = BASE_TS + WINDOW_MS + 1;
        const spray = await engine.detectPasswordSpray(IP, afterWindow);
        assert.equal(spray, false, 'aged-out failures must not classify as a spray');
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
