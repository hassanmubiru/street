// packages/cli/src/tests/grpc-basename-redos.test.ts
// Class B.2 bug-condition exploration test (CodeQL alert #20) — ReDoS.
//
// Bug condition (isBugCondition_B): the `--proto` argument is uncontrolled, so a
// worst-case slash-free value drives the polynomial `/.*\//` strip in the gRPC
// output basename derivation (generate.ts:126) into super-linear backtracking.
//
// Safety / fix-checking property (bugfix.md / design.md Property 2):
//   FOR ALL input WHERE isBugCondition_B(input) DO
//     ASSERT matchTime'(input) is O(n)
//
// Encoded as a LINEAR TIME BUDGET: time at a large size N must stay within the
// time at a small size N0 scaled by N/N0 plus slack. On UNFIXED code `/.*\//`
// retries `.*` from every start position when no `/` is present (~O(n^2)), so
// the larger input blows past the budget and this assertion FAILS — the
// counterexample proving the ReDoS bug exists.
//
// We exercise `deriveGrpcBaseName`, the exported seam that holds the exact
// flagged expression. (The real `generateGrpc` reads the proto file *before*
// this derivation, so a 32k-char slash-free `--proto` value cannot reach the
// pattern through the file path — it would hit ENAMETOOLONG first.)
//
// **Validates: Requirements 1.3**

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { deriveGrpcBaseName } from '../commands/generate.js';

/** Median wall-clock time (ms) of `fn` over `samples` runs, after one warmup. */
function medianMs(fn: () => void, samples = 5): number {
  fn(); // warmup
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

const NBASE = 4000;
const NBIG = 32000;
const K = NBIG / NBASE;
const SLACK = 3;

describe('Class B.2 — generateGrpc basename ReDoS (alert #20, generate.ts:126)', () => {
  it('derives the basename of an adversarial slash-free path in linear time', () => {
    // N-char slash-free value: `/.*\//` matches `.*` to end, finds no `/`,
    // backtracks, then retries from the next start position — O(n^2).
    const make = (n: number) => 'a'.repeat(n);
    const base = medianMs(() => void deriveGrpcBaseName(make(NBASE)));
    const big = medianMs(() => void deriveGrpcBaseName(make(NBIG)));
    const budget = base * K * SLACK;
    const observedRatio = base > 0 ? (big / base).toFixed(1) : 'inf';
    const report =
      `deriveGrpcBaseName("a".repeat(N)): t(N=${NBASE})=${base.toFixed(2)}ms, ` +
      `t(N=${NBIG})=${big.toFixed(2)}ms, observed growth x${observedRatio} ` +
      `(linear≈x${K}), linear budget=${budget.toFixed(2)}ms`;
    console.log(report);
    assert.ok(
      big <= budget,
      `super-linear backtracking detected — ${report} ` +
        `(time exceeds the linear budget, confirming ReDoS / isBugCondition_B)`,
    );
  });
});
