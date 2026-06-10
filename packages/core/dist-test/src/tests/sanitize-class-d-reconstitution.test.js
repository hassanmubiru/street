// tests/sanitize-class-d-reconstitution.test.ts
// Class D bug-condition exploration test (CodeQL alerts #7, #6) —
// incomplete multi-character sanitization / reconstitution.
//
// Bug condition (isBugCondition_D): an input for which a single (or LIMITED)
// sanitization pass still leaves a dangerous substring, because removing one
// match splices two fragments into a NEW dangerous token. A *bounded* pass
// count cannot reach a stable fixed point for deeply-nested reconstitutions.
//
// Safety / fix-checking property (bugfix.md / design.md Property 4):
//   FOR ALL input WHERE isBugCondition_D(input) DO
//     out := sanitizeString'(input)
//     ASSERT out contains no dangerous substring   // stable fixed point
//
// CONTEXT — out-of-band Copilot Autofix:
//   Two autofix commits already touched packages/core/src/security/xss.ts:
//     0c190f4  alert no. 9  — wrapped the chained .replace() in a do/while loop
//                             capped at MAX_SANITIZE_PASSES = 10
//     73487f4  alert no. 14 — HTML_TAGS=/<[^>]*>/g -> /[<>]/g (strip ALL <,>)
//   Those neutralize SHALLOW reconstitutions (e.g. "java<>script:"), but the
//   loop is capped at 10 passes rather than driven to an UNCONDITIONAL fixed
//   point (design task 9.1). A reconstitution nested >10 layers deep therefore
//   still survives — the residual Class D defect.
//
// EXPECTED OUTCOME on the current (capped) source: the deep-nesting case FAILS
// the safety assertion — sanitizeString leaves a reconstituted "javascript:".
// That failure IS the counterexample proving isBugCondition_D still holds.
//
// **Validates: Requirements 1.6**
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeString } from '../security/xss.js';
// ── Dangerous-substring detector ─────────────────────────────────────────────
// Mirrors exactly the tokens sanitizeString is supposed to eliminate: angle
// brackets, the javascript:/data:/vbscript: protocols, on*= event handlers, and
// null bytes. A clean (fixed-point) result must match NONE of these.
const DANGEROUS_PATTERNS = [
    ['angle bracket', /[<>]/],
    ['javascript: protocol', /javascript\s*:/i],
    ['data: protocol', /data\s*:/i],
    ['vbscript: protocol', /vbscript\s*:/i],
    ['on*= handler', /on\w+\s*=/i],
    ['null byte', /\x00/],
];
function firstDangerousSubstring(value) {
    for (const [label, pattern] of DANGEROUS_PATTERNS) {
        if (pattern.test(value))
            return label;
    }
    return null;
}
/**
 * Build a reconstitution payload that needs exactly `depth` sanitization passes
 * to fully neutralize. Each layer wraps the inner "javascript:" so that one
 * global replace peels exactly one layer and reconstitutes a fresh
 * "javascript:":   S1 = "javascript:",  Sn = "java" + S(n-1) + "script:".
 * A loop capped below `depth` leaves a residual "javascript:".
 */
function nestedReconstitution(depth) {
    let s = 'javascript:';
    for (let i = 1; i < depth; i++)
        s = `java${s}script:`;
    return s;
}
describe('Class D — sanitizeString reconstitution (alerts #7, #6)', () => {
    // Shallow reconstitutions the out-of-band autofix already neutralizes — kept
    // to document the boundary of the partial fix (these stabilize in <= 3 passes).
    for (const input of ['<scr<script>ipt>', 'java<>script:', 'javascjavascript:ript:']) {
        it(`reaches a dangerous-substring-free fixed point for ${JSON.stringify(input)}`, () => {
            const out = sanitizeString(input);
            const residual = firstDangerousSubstring(out);
            assert.equal(residual, null, `sanitizeString(${JSON.stringify(input)}) = ${JSON.stringify(out)} still ` +
                `contains a dangerous substring (${residual})`);
        });
    }
    // Deep reconstitution that exceeds the capped pass count: the COUNTEREXAMPLE.
    // On the current (capped at MAX_SANITIZE_PASSES = 10) source this FAILS,
    // proving sanitizeString is not a true fixed point (isBugCondition_D holds).
    it('reaches a stable fixed point for a deeply-nested reconstitution (exceeds the pass cap)', () => {
        const depth = 11; // one layer beyond the autofix's 10-pass cap
        const input = nestedReconstitution(depth);
        const out = sanitizeString(input);
        const residual = firstDangerousSubstring(out);
        assert.equal(residual, null, `sanitizeString(<${depth}-layer reconstitution>) = ${JSON.stringify(out)} still ` +
            `contains a dangerous substring (${residual}) — a bounded/limited pass ` +
            `count was reconstituted into a residual "javascript:" (isBugCondition_D)`);
        // Fixed-point / idempotence: a truly stable result re-sanitizes to itself.
        assert.equal(sanitizeString(out), out, 'sanitizeString is not idempotent for the deep reconstitution — not a stable fixed point');
    });
});
//# sourceMappingURL=sanitize-class-d-reconstitution.test.js.map