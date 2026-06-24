// packages/plugin-marzpay/test/transactions-namespace.test.mjs
// Unit tests (example-based) for the `marzpay.transactions` namespace (Task 2.2).
//
// The namespace exposes a single verified read operation, `get(reference)`, over
// the `GET /transactions/{id}` endpoint (Research_Artifact V3). These tests pin:
//   • the happy path returns a record with id/reference/amount/currency/status
//     (Req 4.1, 4.2);
//   • the reference guard rejects empty/whitespace-only/>256-char values naming
//     the "reference" argument and issues NO network request (Req 4.3);
//   • a non-2xx response throws an error INCLUDING the HTTP status and returns
//     no partial result (Req 4.4).
//
// Pure/offline — wired over a real MarzPayClient with a MOCK transport so the
// verified path (build → send → ensureSuccessStatus → parseTransactionRecord) is
// reused unchanged. Run: npm run coverage -w packages/plugin-marzpay
//
// Validates: Requirements 4.1, 4.2, 4.3, 4.4, 14.3

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { MarzPayClient, MARZPAY_SPEC, createTransactionsNamespace } from '../dist/index.js';

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

/** Build a `transactions` namespace wired to a client over the given transport. */
function namespaceOver(transport) {
  const client = new MarzPayClient(CONFIG, MARZPAY_SPEC, transport);
  const transactions = createTransactionsNamespace({
    getTransaction: (reference) => client.getTransaction(reference),
  });
  return { transactions, transport };
}

describe('transactions namespace — get (unit)', () => {
  it('returns id/reference/amount/currency/status from the verified GET /transactions/{id}', async () => {
    const body = JSON.stringify({
      transaction: {
        uuid: 'txn-uuid-1',
        reference: 'ref-1',
        amount: { raw: 5000, currency: 'UGX' },
        status: 'completed',
      },
    });
    const { transactions, transport } = namespaceOver(capturingTransport({ status: 200, body }));

    const result = await transactions.get('ref-1');

    const req = transport.captured;
    assert.equal(transport.calls, 1, 'exactly one request is sent');
    assert.equal(req.method, 'GET');
    assert.equal(req.url, 'https://wallet.wearemarz.com/api/v1/transactions/ref-1');
    assert.equal(req.body, '', 'GET carries an empty body');
    assert.deepEqual(result, {
      id: 'txn-uuid-1',
      reference: 'ref-1',
      amount: 5000,
      currency: 'UGX',
      status: 'completed',
    });
  });

  it('trims the reference before building the request', async () => {
    const body = JSON.stringify({ transaction: { uuid: 'u', reference: 'ref-2', status: 'pending' } });
    const { transactions, transport } = namespaceOver(capturingTransport({ status: 200, body }));

    await transactions.get('  ref-2  ');

    assert.equal(transport.captured.url, 'https://wallet.wearemarz.com/api/v1/transactions/ref-2');
  });

  it('rejects empty/whitespace-only references naming "reference" and sends nothing', async () => {
    for (const bad of ['', '   ', '\t\n']) {
      const { transactions, transport } = namespaceOver(capturingTransport({ status: 200, body: '{}' }));
      await assert.rejects(
        () => transactions.get(bad),
        (err) => err instanceof Error && /reference/.test(err.message),
        `"${bad}" must be rejected naming the "reference" argument`,
      );
      assert.equal(transport.calls, 0, 'no request may be sent for an invalid reference');
    }
  });

  it('rejects a reference longer than 256 chars naming "reference" and sends nothing', async () => {
    const { transactions, transport } = namespaceOver(capturingTransport({ status: 200, body: '{}' }));
    await assert.rejects(
      () => transactions.get('a'.repeat(257)),
      (err) => err instanceof Error && /reference/.test(err.message),
      'an over-long reference must be rejected naming the "reference" argument',
    );
    assert.equal(transport.calls, 0, 'no request may be sent for an over-long reference');
  });

  it('maps a non-2xx response to an error including the HTTP status and no partial result', async () => {
    const { transactions, transport } = namespaceOver(capturingTransport({ status: 404, body: '{}' }));
    let value;
    await assert.rejects(
      async () => {
        value = await transactions.get('ref-missing');
      },
      (err) => err instanceof Error && /404/.test(err.message),
      'a 404 must surface an error including the HTTP status',
    );
    assert.equal(transport.calls, 1, 'the request was sent and the non-2xx status surfaced');
    assert.equal(value, undefined, 'no partial result is returned on a non-2xx response');
  });
});
