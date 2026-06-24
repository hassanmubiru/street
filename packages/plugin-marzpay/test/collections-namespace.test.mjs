// packages/plugin-marzpay/test/collections-namespace.test.mjs
// Unit tests (example-based) for the `marzpay.collections` namespace (Task 2.3).
//
// The collections namespace (Requirement 2) exposes two VERIFIED operations:
//   • collectMoney(req) → POST /collect-money (Research_Artifact V2 collection-create)
//   • getStatus(reference) → GET /transactions/{reference} (Research_Artifact V3)
//
// These complement the existing `transactions-namespace.test.mjs` (Task 2.2) by
// pinning the collections happy paths and the non-2xx error mapping that
// `transactions-namespace.test.mjs` does NOT cover. To exercise the surface the
// way the requirements describe it ("MarzPayClient now exposes `collections`,
// `transactions`, … as instance members"), the namespaces are reached through a
// real `new MarzPayClient(CONFIG, MARZPAY_SPEC, transport)` with a MOCK transport
// so the verified path (build → send → ensureSuccessStatus → defensive parse) is
// reused unchanged and nothing touches the network.
//
// Pins:
//   • collectMoney parses a verified V2 mobile-money response → {reference,status}
//     and a V2 card response → {reference,status,redirectUrl} (Req 2.2);
//   • getStatus parses a verified V3 transaction-detail response →
//     {reference,status} (Req 2.4) and trims the reference;
//   • a single transactions.get happy path confirms the client member is wired
//     to the verified V3 shape (Req 4.2) without duplicating the Task 2.2 guards;
//   • a non-2xx status for collectMoney AND getStatus surfaces an error INCLUDING
//     the HTTP status and returns no partial result (Req 2.6, 4.4).
//
// Run: npm run coverage -w packages/plugin-marzpay
//
// Validates: Requirements 2.2, 2.6, 4.2, 4.4, 14.3

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { MarzPayClient, MARZPAY_SPEC } from '../dist/index.js';

/** Base config; the transport is injected so nothing ever networks. */
const CONFIG = { apiKey: 'ak-test', secretKey: 'sk-test', environment: 'sandbox' };

/** A transport that captures the request it receives and resolves a fixed response. */
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

/** A client whose namespaces are wired over the given mock transport. */
function clientOver(transport) {
  return new MarzPayClient(CONFIG, MARZPAY_SPEC, transport);
}

// ── collections.collectMoney — happy paths (Req 2.2) ─────────────────────────
describe('collections.collectMoney — happy path (unit)', () => {
  it('parses a verified V2 mobile-money response into {reference,status}', async () => {
    // Verified V2 collect-money success shape: status:"success" + data.transaction.
    const body = JSON.stringify({
      status: 'success',
      data: { transaction: { reference: 'ref-mm-1', status: 'processing' } },
    });
    const transport = capturingTransport({ status: 200, body });
    const client = clientOver(transport);

    const result = await client.collections.collectMoney({
      amount: 5000,
      country: 'UG',
      reference: 'ref-mm-1',
      phone_number: '+256700000000',
    });

    const req = transport.captured;
    assert.equal(transport.calls, 1, 'exactly one request is sent');
    assert.equal(req.method, 'POST');
    assert.equal(req.url, 'https://wallet.wearemarz.com/api/v1/collect-money');
    const sent = JSON.parse(req.body);
    assert.equal(sent.phone_number, '+256700000000');
    assert.equal(sent.method, undefined, 'mobile money carries no card method');
    assert.deepEqual(result, { reference: 'ref-mm-1', status: 'processing' });
    assert.equal(result.redirectUrl, undefined, 'mobile money carries no redirect URL');
  });

  it('parses a verified V2 card response and surfaces data.redirect_url', async () => {
    const body = JSON.stringify({
      status: 'success',
      data: {
        transaction: { reference: 'ref-card-1', status: 'pending' },
        redirect_url: 'https://pay.example/redirect/abc',
      },
    });
    const transport = capturingTransport({ status: 201, body });
    const client = clientOver(transport);

    const result = await client.collections.collectMoney({
      amount: 25000,
      country: 'UG',
      reference: 'ref-card-1',
      method: 'card',
    });

    const sent = JSON.parse(transport.captured.body);
    assert.equal(sent.method, 'card', 'card channel selector is sent');
    assert.equal(sent.phone_number, undefined, 'card flow carries no phone number');
    assert.deepEqual(result, {
      reference: 'ref-card-1',
      status: 'pending',
      redirectUrl: 'https://pay.example/redirect/abc',
    });
  });
});

// ── collections.getStatus — happy path (Req 2.4) ─────────────────────────────
describe('collections.getStatus — happy path (unit)', () => {
  it('parses a verified V3 transaction-detail response into {reference,status}', async () => {
    const body = JSON.stringify({
      transaction: {
        uuid: 'txn-uuid-9',
        reference: 'ref-s-1',
        amount: { raw: 5000, currency: 'UGX' },
        status: 'completed',
      },
    });
    const transport = capturingTransport({ status: 200, body });
    const client = clientOver(transport);

    const result = await client.collections.getStatus('ref-s-1');

    const req = transport.captured;
    assert.equal(transport.calls, 1, 'exactly one request is sent');
    assert.equal(req.method, 'GET');
    assert.equal(req.url, 'https://wallet.wearemarz.com/api/v1/transactions/ref-s-1');
    assert.equal(req.body, '', 'GET carries an empty body');
    assert.deepEqual(result, { reference: 'ref-s-1', status: 'completed' });
  });

  it('trims the reference before building the request', async () => {
    const body = JSON.stringify({ transaction: { reference: 'ref-s-2', status: 'pending' } });
    const transport = capturingTransport({ status: 200, body });
    const client = clientOver(transport);

    await client.collections.getStatus('  ref-s-2  ');

    assert.equal(transport.captured.url, 'https://wallet.wearemarz.com/api/v1/transactions/ref-s-2');
  });
});

// ── transactions.get — happy path via the client member (Req 4.2) ────────────
// One happy-path assertion that the `client.transactions` member is wired to the
// verified V3 shape. The full reference-guard / non-2xx coverage for the
// transactions namespace lives in `transactions-namespace.test.mjs` (Task 2.2);
// this avoids duplicating those cases while still pinning the client wiring.
describe('transactions.get — happy path via client member (unit)', () => {
  it('returns id/reference/amount/currency/status from a verified V3 response', async () => {
    const body = JSON.stringify({
      transaction: {
        uuid: 'txn-uuid-1',
        reference: 'ref-t-1',
        amount: { raw: 5000, currency: 'UGX' },
        status: 'completed',
      },
    });
    const transport = capturingTransport({ status: 200, body });
    const client = clientOver(transport);

    const result = await client.transactions.get('ref-t-1');

    assert.equal(transport.captured.url, 'https://wallet.wearemarz.com/api/v1/transactions/ref-t-1');
    assert.deepEqual(result, {
      id: 'txn-uuid-1',
      reference: 'ref-t-1',
      amount: 5000,
      currency: 'UGX',
      status: 'completed',
    });
  });
});

// ── Non-2xx mapping for collections (Req 2.6) ────────────────────────────────
describe('collections — non-2xx surfaces the HTTP status, no partial result (Req 2.6)', () => {
  it('collectMoney maps a non-2xx response to an error including the HTTP status', async () => {
    const transport = capturingTransport({ status: 502, body: '{}' });
    const client = clientOver(transport);

    let value;
    await assert.rejects(
      async () => {
        value = await client.collections.collectMoney({
          amount: 5000,
          country: 'UG',
          reference: 'ref-mm-err',
          phone_number: '+256700000000',
        });
      },
      (err) => err instanceof Error && /502/.test(err.message),
      'a 502 must surface an error including the HTTP status',
    );
    assert.equal(transport.calls, 1, 'the request was sent and the non-2xx status surfaced');
    assert.equal(value, undefined, 'no partial result is returned on a non-2xx response');
  });

  it('getStatus maps a non-2xx response to an error including the HTTP status', async () => {
    const transport = capturingTransport({ status: 404, body: '{}' });
    const client = clientOver(transport);

    let value;
    await assert.rejects(
      async () => {
        value = await client.collections.getStatus('ref-missing');
      },
      (err) => err instanceof Error && /404/.test(err.message),
      'a 404 must surface an error including the HTTP status',
    );
    assert.equal(transport.calls, 1, 'the request was sent and the non-2xx status surfaced');
    assert.equal(value, undefined, 'no partial result is returned on a non-2xx response');
  });
});
