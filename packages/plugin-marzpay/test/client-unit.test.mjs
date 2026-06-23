// packages/plugin-marzpay/test/client-unit.test.mjs
// Unit tests (example-based) for the MarzPayClient operations that the
// documented suite scope (Requirement 14.1) names explicitly:
//   • payment initialization  (initializePayment)
//   • payment verification     (verifyPayment)
//   • Webhook validation       (validateWebhook)
//
// Pure/offline — every case injects a MOCK MarzPayTransport into the client
// constructor (`new MarzPayClient(config, spec?, transport?)`), so the built
// request is captured and the parsed result is asserted WITHOUT touching the
// network. These complement the transport PROPERTY tests (Properties 5 & 6,
// status/timeout) and the webhook signing PROPERTY test (Property 7) by pinning
// concrete request-shape and parse examples for the three named operations.
// Run: npm test -w packages/plugin-marzpay
//
// Validates: Requirements 14.1, 3.1, 3.2, 3.6, 3.7

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { MarzPayClient, MARZPAY_SPEC } from '../dist/index.js';

/** Base config; the transport is injected so nothing ever networks. */
const CONFIG = { apiKey: 'ak-test', secretKey: 'sk-test', environment: 'sandbox' };

/**
 * A transport that captures the single request it receives and resolves a fixed
 * response. `captured` holds the last `MarzPayHttpRequest` passed by the client.
 */
function capturingTransport(response) {
  const transport = (req, _timeoutMs) => {
    transport.captured = req;
    transport.calls += 1;
    return Promise.resolve(response);
  };
  transport.captured = undefined;
  transport.calls = 0;
  return transport;
}

// ── Payment initialization (unit) ───────────────────────────────────────────
describe('MarzPayClient.initializePayment (unit)', () => {
  it('builds the verified POST /collect-money request (mobile money) and parses the result', async () => {
    const body = JSON.stringify({
      data: { transaction: { reference: 'ref-mm-1', status: 'processing' } },
    });
    const transport = capturingTransport({ status: 200, body });
    const client = new MarzPayClient(CONFIG, MARZPAY_SPEC, transport);

    const result = await client.initializePayment({
      amount: 5000,
      country: 'UG',
      reference: 'ref-mm-1',
      phone_number: '+256700000000',
    });

    // The request the transport received is the verified collect-money POST.
    const req = transport.captured;
    assert.equal(transport.calls, 1, 'exactly one request is sent');
    assert.equal(req.method, 'POST');
    assert.equal(req.url, 'https://wallet.wearemarz.com/api/v1/collect-money');
    assert.equal(req.headers['Content-Type'], 'application/json');
    assert.match(req.headers.Authorization, /^Basic /, 'HTTP Basic auth header is set');
    const sentBody = JSON.parse(req.body);
    assert.equal(sentBody.amount, 5000);
    assert.equal(sentBody.country, 'UG');
    assert.equal(sentBody.reference, 'ref-mm-1');
    assert.equal(sentBody.phone_number, '+256700000000');
    assert.equal(sentBody.method, undefined, 'mobile money carries no card method');

    // The parsed result reflects the collection-create response.
    assert.equal(result.reference, 'ref-mm-1');
    assert.equal(result.status, 'processing');
  });

  it('builds a card collection (method:"card") and surfaces the redirect URL', async () => {
    const body = JSON.stringify({
      data: {
        transaction: { reference: 'ref-card-1', status: 'pending' },
        redirect_url: 'https://pay.example/redirect/abc',
      },
    });
    const transport = capturingTransport({ status: 201, body });
    const client = new MarzPayClient(CONFIG, MARZPAY_SPEC, transport);

    const result = await client.initializePayment({
      amount: 25000,
      country: 'UG',
      reference: 'ref-card-1',
      method: 'card',
    });

    const sentBody = JSON.parse(transport.captured.body);
    assert.equal(sentBody.method, 'card', 'card channel selector is sent');
    assert.equal(sentBody.phone_number, undefined, 'card flow carries no phone number');
    assert.equal(result.reference, 'ref-card-1');
    assert.equal(result.status, 'pending');
    assert.equal(result.redirectUrl, 'https://pay.example/redirect/abc');
  });

  it('rejects a missing payment channel BEFORE sending (named field, no request)', async () => {
    const transport = capturingTransport({ status: 200, body: '{}' });
    const client = new MarzPayClient(CONFIG, MARZPAY_SPEC, transport);

    await assert.rejects(
      () => client.initializePayment({ amount: 1000, country: 'UG', reference: 'ref-x' }),
      (err) => err instanceof Error && /phone_number|card/.test(err.message),
      'a request with no channel must be rejected naming the channel options',
    );
    assert.equal(transport.calls, 0, 'no request may be sent when the builder rejects');
  });
});

// ── Payment verification (unit) ─────────────────────────────────────────────
describe('MarzPayClient.verifyPayment (unit)', () => {
  it('builds the verified GET /transactions/{reference} request and parses the status', async () => {
    const body = JSON.stringify({ transaction: { reference: 'ref-v-1', status: 'completed' } });
    const transport = capturingTransport({ status: 200, body });
    const client = new MarzPayClient(CONFIG, MARZPAY_SPEC, transport);

    const result = await client.verifyPayment('  ref-v-1  '); // trimmed by the guard

    const req = transport.captured;
    assert.equal(req.method, 'GET');
    assert.equal(req.url, 'https://wallet.wearemarz.com/api/v1/transactions/ref-v-1');
    assert.equal(req.body, '', 'GET carries an empty body');
    assert.deepEqual(result, { reference: 'ref-v-1', status: 'completed' });
  });

  it('rejects an empty reference BEFORE sending (named argument, no request)', async () => {
    const transport = capturingTransport({ status: 200, body: '{}' });
    const client = new MarzPayClient(CONFIG, MARZPAY_SPEC, transport);

    await assert.rejects(
      () => client.verifyPayment('   '),
      (err) => err instanceof Error && /reference/.test(err.message),
      'an empty reference must be rejected naming the "reference" argument',
    );
    assert.equal(transport.calls, 0, 'no request may be sent for an empty reference');
  });
});

// ── Webhook validation (unit) ───────────────────────────────────────────────
// MarzPayClient.validateWebhook delegates to verifyWebhookSignature(spec.webhook,
// …). With the real MARZPAY_SPEC the webhook scheme is UNBOUND (Research_Artifact
// §L4), so validateWebhook returns false for ALL signature material — the
// documented server-side re-verification trust path is used instead of trusting
// an invented signature scheme (verify-don't-invent).
describe('MarzPayClient.validateWebhook (unit)', () => {
  const client = new MarzPayClient(CONFIG, MARZPAY_SPEC);
  const body = '{"event_type":"payment.success","transaction":{"reference":"ref-1"}}';

  it('returns false for absent/empty signature material (unbound scheme)', () => {
    assert.equal(client.validateWebhook(body, undefined), false);
    assert.equal(client.validateWebhook(body, ''), false);
  });

  it('returns false even for a non-empty signature because the scheme is unbound', () => {
    assert.equal(client.validateWebhook(body, 'deadbeefcafef00d'), false);
  });
});
