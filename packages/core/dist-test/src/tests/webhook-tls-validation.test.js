// tests/webhook-tls-validation.test.ts
// Class A bug-condition exploration test (CodeQL alert #24).
//
// Bug condition (isBugCondition_A): a WebhookTarget configured with
//   target.tls != null AND target.tls.rejectUnauthorized === false
//
// Safety property (fix-checking, bugfix.md / design.md Property 1):
//   FOR ALL target WHERE isBugCondition_A(target) DO
//     options := buildRequestOptions'(target)
//     ASSERT options.rejectUnauthorized != false   // validation never disabled
//
// On UNFIXED code this assertion FAILS because the options object carries
// `rejectUnauthorized: false`, proving the TLS-validation leak exists.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildRequestOptions } from '../webhook/dispatcher.js';
describe('Class A — webhook TLS validation leak (alert #24)', () => {
    it('never disables certificate validation for a target satisfying isBugCondition_A', () => {
        // Target satisfying isBugCondition_A: tls present AND rejectUnauthorized === false.
        const tls = { rejectUnauthorized: false };
        const options = buildRequestOptions('https://evil.example/hook', 42, 'sha256=deadbeef', 10_000, tls);
        // SAFETY assertion: certificate validation must never be disabled.
        // On unfixed code the options object carries `rejectUnauthorized: false`,
        // so this assertion FAILS — the counterexample that proves the leak.
        assert.notEqual(options.rejectUnauthorized, false, 'options leaked rejectUnauthorized:false — TLS certificate validation is disabled');
    });
});
//# sourceMappingURL=webhook-tls-validation.test.js.map