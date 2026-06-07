// tests/redos-class-b-timing.test.ts
// Class B bug-condition exploration test (CodeQL alerts #26, #19) — ReDoS.
//
// Bug condition (isBugCondition_B): every externally-supplied string reaches a
// polynomial regular expression, so worst-case input causes super-linear
// (quadratic) backtracking and CPU-exhaustion denial-of-service.
//
// Safety / fix-checking property (bugfix.md / design.md Property 2):
//   FOR ALL input WHERE isBugCondition_B(input) DO
//     ASSERT matchTime'(input) is O(n)   // no super-linear backtracking
//
// We encode that O(n) property as a LINEAR TIME BUDGET: scale the time observed
// at a small size N0 by the size ratio (N/N0) plus generous slack, and assert
// the time at the larger size stays within that budget. On UNFIXED code the
// patterns are O(n^2), so doubling the work ~8x multiplies time ~64x — far
// beyond the linear budget — and these assertions FAIL. The failure IS the
// counterexample proving the ReDoS bug exists.
//
// Covered here (both reachable via exported functions):
//   B.1  base32Decode  — auth/mfa.ts:31         /=+$/g     '='.repeat(N) + 'A'
//   B.3  parseProto    — grpc/proto-parser.ts:40 /\/\*[\s\S]*?\*\//g
//
// B.2 (generateGrpc basename — packages/cli) lives in the CLI package's
// grpc-basename-redos.test.ts because core cannot import the CLI package.
//
// **Validates: Requirements 1.2, 1.4**

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { base32Decode } from '../auth/mfa.js';
import { parseProto } from '../microservices/grpc/proto-parser.js';

// ── Timing harness ──────────────────────────────────────────────────────────

/** Median wall-clock time (ms) of `fn` over `samples` runs, after one warmup. */
function medianMs(fn: () => void, samples = 5): number {
  fn(); // warmup (JIT / first-call costs excluded from the measurement)
  const times: number[] = [];
  for (let i = 0; i < samples; i++) {
    const t0 = process.hrtime.bigint();
    fn();
    const t1 = process.hrtime.bigint();
    times.push(Number(t1 - t0) / 1e6);
  }
  times.sort((a, b) => a - b);
  return times[Math.floor(times.length / 2)]!;
}

// Adversarial sizes. k = NBIG / NBASE = 8.
const NBASE = 4000;
const NBIG = 32000;
const K = NBIG / NBASE;
// A truly linear implementation scales ~K. We allow K * SLACK head-room so the
// fixed code passes comfortably while quadratic blow-up (~K^2 = 64x) still fails.
const SLACK = 3;

/**
 * Assert the work at NBIG stays within a linear-time budget extrapolated from
 * NBASE. Returns a human-readable growth report (used to document the
 * counterexample when this assertion fails on unfixed, super-linear code).
 */
function assertLinearTimeBudget(label: string, run: (input: string) => void, make: (n: number) => string): string {
  const base = medianMs(() => run(make(NBASE)));
  const big = medianMs(() => run(make(NBIG)));
  const budget = base * K * SLACK;
  const observedRatio = base > 0 ? (big / base).toFixed(1) : 'inf';
  const report =
    `${label}: t(N=${NBASE})=${base.toFixed(2)}ms, t(N=${NBIG})=${big.toFixed(2)}ms, ` +
    `observed growth x${observedRatio} (linear≈x${K}), linear budget=${budget.toFixed(2)}ms`;
  assert.ok(
    big <= budget,
    `super-linear backtracking detected — ${report} ` +
      `(time exceeds the linear budget, confirming ReDoS / isBugCondition_B)`,
  );
  return report;
}

// ── B.1 — base32Decode trailing-padding strip /=+$/g ─────────────────────────

describe('Class B.1 — base32Decode ReDoS (alert #26, auth/mfa.ts:31)', () => {
  it('processes adversarial padding input in linear time', () => {
    // '='.repeat(N) + 'A': the '=' run is NOT at end-of-string, so /=+$/g
    // greedily matches the whole run then backtracks one '=' at a time from
    // every start position — O(n^2). (The decode loop then throws on '=', but
    // the cost is paid in the regex before the throw.)
    const report = assertLinearTimeBudget(
      'base32Decode("=".repeat(N)+"A")',
      (input) => {
        try {
          base32Decode(input);
        } catch {
          /* invalid '=' char throws after the regex runs; timing is what matters */
        }
      },
      (n) => '='.repeat(n) + 'A',
    );
    console.log(report);
  });
});

// ── B.3 — parseProto block-comment strip /\/\*[\s\S]*?\*\//g ──────────────────

describe('Class B.3 — parseProto ReDoS (alert #19, grpc/proto-parser.ts:40)', () => {
  it('parses adversarial unterminated block comments in linear time', () => {
    // Many unterminated `/*` openers with no `*/` closer: for each opener the
    // lazy `[\s\S]*?\*\/` rescans toward end-of-input looking for `*/`, never
    // finds it, then the global match advances to the next opener and rescans
    // again — O(n^2). (NB: the literal '/*'.repeat(N) from the design write-up
    // is accidentally benign because "/*/*" contains the "*/" closer; using
    // '/*a' openers exposes the documented super-linear rescan.)
    const report = assertLinearTimeBudget(
      'parseProto("/*a".repeat(N))',
      (input) => {
        parseProto(input);
      },
      (n) => '/*a'.repeat(n),
    );
    console.log(report);
  });
});
