// tests/sanitize-class-d-reconstitution.test.ts
// Class D bug-condition exploration test (CodeQL alerts #7, #6) —
// incomplete multi-character sanitization / reconstitution.
//
// Bug condition (isBugCondition_D): an input for which a single (or limited)
// sanitization pass still leaves a dangerous substring, because removing one
// match splices two fragments into a NEW dangerous token that the same pass no
// longer re-scans (e.g. "javascjavascript:ript:" -> after one pass ->
// "javascript:", or "java<>script:" -> after the angle-bracket removal ->
// "javascript:").
//
// Safety / fix-checking property (bugfix.md / design.md Property 4):
//   FOR ALL input WHERE isBugCondition_D(input) DO
//     out := sanitizeString'(input)
//     ASSERT out contains no dangerous substring   // stable fixed point
//
// EXPECTED (per the task) on the UNFIXED single-pass artifact: this assertion
// FAILS because the output still contains a reconstituted dangerous substring
// (e.g. "javascript:"). The failure IS the counterexample proving the bug.
//
// **Validates: Requirements 1.6**

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeString } from '../security/xss.js';

// ── Dangerous-substring detector ─────────────────────────────────────────────
// Mirrors exactly the tokens sanitizeString is supposed to eliminate: angle
// brackets, the javascript:/data:/vbscript: protocols, on*= event handlers, and
// null bytes. A clean (fixed-point) result must match NONE of these.
const DANGEROUS_PATTERNS: ReadonlyArray<readonly [string, RegExp]> = [
  ['angle bracket', /[<>]/],
  ['javascript: protocol', /javascript\s*:/i],
  ['data: protocol', /data\s*:/i],
  ['vbscript: protocol', /vbscript\s*:/i],
  ['on*= handler', /on\w+\s*=/i],
  ['null byte', /\x00/],
];

function firstDangerousSubstring(value: string): string | null {
  for (const [label, pattern] of DANGEROUS_PATTERNS) {
    if (pattern.test(value)) return label;
  }
  return null;
}

// Inputs satisfying isBugCondition_D: each one, under a single/limited pass,
// can be reconstituted into a dangerous substring after an earlier removal.
const RECONSTITUTABLE_INPUTS: ReadonlyArray<string> = [
  '<scr<script>ipt>',
  'java<>script:',
  // Split-protocol reconstitution: removing the inner "javascript:" splices
  // the outer fragments into a fresh "javascript:" that a single global pass
  // cannot re-scan.
  'javascjavascript:ript:',
  'jajavascript:vascript:',
];

describe('Class D — sanitizeString reconstitution (alerts #7, #6)', () => {
  for (const input of RECONSTITUTABLE_INPUTS) {
    it(`reaches a dangerous-substring-free fixed point for ${JSON.stringify(input)}`, () => {
      const out = sanitizeString(input);

      // SAFETY assertion: the sanitized result must contain no dangerous
      // substring. On the unfixed single-pass artifact this FAILS because a
      // dangerous token (e.g. "javascript:") is reconstituted after one pass.
      const residual = firstDangerousSubstring(out);
      assert.equal(
        residual,
        null,
        `sanitizeString(${JSON.stringify(input)}) = ${JSON.stringify(out)} still ` +
          `contains a dangerous substring (${residual}) — single-pass ` +
          `sanitization was reconstituted (isBugCondition_D)`,
      );

      // Fixed-point / idempotence: a stable result re-sanitizes to itself.
      assert.equal(
        sanitizeString(out),
        out,
        `sanitizeString is not idempotent for ${JSON.stringify(input)} — ` +
          `not a stable fixed point`,
      );
    });
  }
});
