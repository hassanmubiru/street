// Property-based + unit tests for MarzPayClient transport-layer behavior:
// HTTP status handling and timeout/unavailability handling. NO real network —
// every case injects a MOCK MarzPayTransport into the client constructor
// (`new MarzPayClient(config, spec?, transport?)`), so status/timeout logic is
// exercised deterministically without sockets or timers.
// Run: npm test -w packages/plugin-marzpay
//
// Covers two design.md Correctness Properties:
//   • Property 5 — Non-success HTTP status raises, never returns a partial
//     result (Req 3.8)
//   • Property 6 — Timeout/unavailability raises, never returns a partial
//     result (Req 3.11)

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';

import { MarzPayClient, MARZPAY_SPEC } from '../dist/index.js';

const RUNS = 200; // ≥100 iterations per property.

/** Base config used by every case; transport is injected, so it never networks. */
const CONFIG = { apiKey: 'ak', secretKey: 'sk', environment: 'sandbox', timeoutMs: 30_000 };

/** A valid reference/id that survives the pure builder guards (non-empty, ≤256). */
const VALID_ID = 'ref-123';
/** A valid initializePayment request so the builder doesn't throw before sending. */
const VALID_PAYMENT = { amount: 1000, country: 'UG', reference: 'ref-123', phone_number: '+256700000000' };

/**
 * The four networked operations, each invoked with valid args so the pure
 * builders pass and execution reaches the injected transport. `listTransactions`
 * is called with no query (no required args).
 */
const OPERATIONS = [
  { name: 'initializePayment', invoke: (client) => client.initializePayment(VALID_PAYMENT) },
  { name: 'verifyPayment', invoke: (client) => client.verifyPayment(VALID_ID) },
  { name: 'getTransaction', invoke: (client) => client.getTransaction(VALID_ID) },
  { name: 'listTransactions', invoke: (client) => client.listTransactions() },
];

const opName = fc.constantFrom(...OPERATIONS.map((o) => o.name));
const opByName = (name) => OPERATIONS.find((o) => o.name === name);

/** A transport that records whether it was called and resolves a fixed response. */
function resolvingTransport(response) {
  const transport = (_req, _timeoutMs) => {
    transport.calls += 1;
    return Promise.resolve(response);
  };
  transport.calls = 0;
  return transport;
}

/** A transport that rejects with the given error (simulates timeout/socket error). */
function rejectingTransport(error) {
  const transport = (_req, _timeoutMs) => {
    transport.calls += 1;
    return Promise.reject(error);
  };
  transport.calls = 0;
  return transport;
}

// ── 2xx success sanity (unit) ───────────────────────────────────────────────
// Confirms the transport seam is wired correctly: a 200 + valid JSON body
// resolves to a parsed result. This anchors the negative properties below
// (proving they reject for the right reason, not because the seam is broken).
describe('MarzPayClient transport: 2xx success sanity', () => {
  it('resolves verifyPayment with a parsed result on status 200 + valid JSON', async () => {
    const body = JSON.stringify({ transaction: { reference: 'ref-123', status: 'completed' } });
    const client = new MarzPayClient(CONFIG, MARZPAY_SPEC, resolvingTransport({ status: 200, body }));
    const result = await client.verifyPayment(VALID_ID);
    assert.deepEqual(result, { reference: 'ref-123', status: 'completed' });
  });

  it('resolves initializePayment with a parsed result on status 201 + valid JSON', async () => {
    const body = JSON.stringify({ data: { transaction: { reference: 'ref-123', status: 'processing' } } });
    const client = new MarzPayClient(CONFIG, MARZPAY_SPEC, resolvingTransport({ status: 201, body }));
    const result = await client.initializePayment(VALID_PAYMENT);
    assert.equal(result.reference, 'ref-123');
    assert.equal(result.status, 'processing');
  });
});

// ── Property 5 ────────────────────────────────────────────────────────────────
// Feature: marzpay-integration, Property 5: Non-success HTTP status raises, never returns a partial result
// Validates: Requirements 3.8
//
// For all responses whose status is OUTSIDE 200–299, every networked operation
// rejects with an error whose message INCLUDES the returned status, and returns
// no result (no partial value is produced). The mock transport resolves
// { status, body } — even with a structurally-valid body, a non-2xx status must
// short-circuit to an error before any result is returned.
describe('Property 5: Non-success HTTP status raises, never returns a partial result', () => {
  // Status codes outside the 2xx success band: 100–199 and 300–599.
  const nonSuccessStatus = fc.oneof(
    fc.integer({ min: 100, max: 199 }),
    fc.integer({ min: 300, max: 599 }),
  );
  // A body that WOULD parse into a result if the status check were skipped —
  // ensures the rejection is due to the status, not a parse failure.
  const validishBody = fc.constantFrom(
    JSON.stringify({ transaction: { reference: 'ref-123', status: 'completed' } }),
    JSON.stringify({ data: { transaction: { reference: 'ref-123', status: 'processing' } } }),
    JSON.stringify({ data: { transactions: [] } }),
    '{}',
  );

  it('every operation rejects with an error including the status, returning no result', async () => {
    await fc.assert(
      fc.asyncProperty(opName, nonSuccessStatus, validishBody, async (name, status, body) => {
        const transport = resolvingTransport({ status, body });
        const client = new MarzPayClient(CONFIG, MARZPAY_SPEC, transport);

        let returned;
        let threw = false;
        let message = '';
        try {
          returned = await opByName(name).invoke(client);
        } catch (err) {
          threw = true;
          message = err instanceof Error ? err.message : String(err);
        }

        // Must reject (no partial result returned).
        assert.equal(threw, true, `${name} must reject on non-success status ${status}`);
        assert.equal(returned, undefined, `${name} must return no partial result on status ${status}`);
        // The error message must include the returned HTTP status.
        assert.ok(
          message.includes(String(status)),
          `${name} error message must include status ${status}; got: ${message}`,
        );
        // The transport was reached (proving the builder didn't reject first).
        assert.equal(transport.calls, 1, `${name} should have sent exactly one request`);
      }),
      { numRuns: RUNS },
    );
  });
});

// ── Property 6 ────────────────────────────────────────────────────────────────
// Feature: marzpay-integration, Property 6: Timeout/unavailability raises, never returns a partial result
// Validates: Requirements 3.11
//
// For all operations, when the transport REJECTS (simulating a request timeout
// or an unreachable endpoint), the operation rejects with the same
// timeout/unavailability error and returns no partial result. The mock
// transport rejects synchronously with a PluginError-shaped error — no real
// timers/sleeps are used, so the case is deterministic.
describe('Property 6: Timeout/unavailability raises, never returns a partial result', () => {
  // Errors a real transport would reject with: a timeout or an unreachable
  // endpoint. Mirrors the messages produced by defaultMarzPayTransport.
  const transportError = fc.oneof(
    fc.integer({ min: 1, max: 120_000 }).map((ms) => new Error(`MarzPay request timed out after ${ms}ms`)),
    fc.constantFrom('ECONNREFUSED', 'ENOTFOUND', 'ECONNRESET', 'EHOSTUNREACH').map(
      (code) => new Error(`MarzPay request failed (endpoint unreachable): ${code}`),
    ),
  );

  it('every operation rejects with the timeout/unavailability error and returns no result', async () => {
    await fc.assert(
      fc.asyncProperty(opName, transportError, async (name, error) => {
        const transport = rejectingTransport(error);
        const client = new MarzPayClient(CONFIG, MARZPAY_SPEC, transport);

        let returned;
        let threw = false;
        let caught;
        try {
          returned = await opByName(name).invoke(client);
        } catch (err) {
          threw = true;
          caught = err;
        }

        // Must reject (no partial result returned).
        assert.equal(threw, true, `${name} must reject when the transport rejects`);
        assert.equal(returned, undefined, `${name} must return no partial result on transport rejection`);
        // The rejection surfaces the transport's timeout/unavailability error.
        assert.ok(caught instanceof Error, `${name} should reject with an Error`);
        assert.ok(
          /timed out|unreachable/i.test(caught.message),
          `${name} error must indicate timeout/unavailability; got: ${caught.message}`,
        );
        // The transport was reached (proving the builder didn't reject first).
        assert.equal(transport.calls, 1, `${name} should have attempted exactly one request`);
      }),
      { numRuns: RUNS },
    );
  });
});
