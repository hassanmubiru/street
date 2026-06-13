// gateways.test.ts
// Unit tests for the Stripe and PayPal adapters using a stub fetch (no network):
// verifies request shaping and charge/refund parsing + decline handling.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { StripeGateway, PaypalGateway, type FetchLike } from '../gateways.js';
import { PaymentError } from '../index.js';

function stub(responseBody: unknown, ok = true, status = 200) {
  const calls: { url: string; init: { method: string; headers: Record<string, string>; body: string } }[] = [];
  const fetch: FetchLike = async (url, init) => {
    calls.push({ url, init });
    return { ok, status, async text() { return JSON.stringify(responseBody); }, async json() { return responseBody; } };
  };
  return { fetch, calls };
}

describe('StripeGateway', () => {
  it('creates a confirmed PaymentIntent and returns the id', async () => {
    const { fetch, calls } = stub({ id: 'pi_123', status: 'succeeded' });
    const gw = new StripeGateway({ apiKey: 'sk_test', fetch });
    const res = await gw.charge({ amountCents: 3000, currency: 'USD', reference: 'order-1' });
    assert.equal(calls[0]!.url, 'https://api.stripe.com/v1/payment_intents');
    assert.equal(calls[0]!.init.headers['authorization'], 'Bearer sk_test');
    assert.match(calls[0]!.init.body, /amount=3000/);
    assert.match(calls[0]!.init.body, /currency=usd/);
    assert.deepEqual(res, { id: 'pi_123', status: 'succeeded' });
  });

  it('throws PaymentError when the intent is not succeeded', async () => {
    const { fetch } = stub({ id: 'pi_1', status: 'requires_payment_method' });
    const gw = new StripeGateway({ apiKey: 'k', fetch });
    await assert.rejects(() => gw.charge({ amountCents: 100, currency: 'USD', reference: 'r' }), PaymentError);
  });

  it('throws on non-ok responses and refunds the intent', async () => {
    const errStub = stub({ error: 'bad' }, false, 402);
    const gw = new StripeGateway({ apiKey: 'k', fetch: errStub.fetch });
    await assert.rejects(() => gw.charge({ amountCents: 100, currency: 'USD', reference: 'r' }), /stripe API error 402/);

    const okStub = stub({ id: 're_1', status: 'succeeded' });
    const gw2 = new StripeGateway({ apiKey: 'k', fetch: okStub.fetch });
    await gw2.refund('pi_123');
    assert.equal(okStub.calls[0]!.url, 'https://api.stripe.com/v1/refunds');
    assert.match(okStub.calls[0]!.init.body, /payment_intent=pi_123/);
  });
});

describe('PaypalGateway', () => {
  it('captures an order and formats the amount as major units', async () => {
    const { fetch, calls } = stub({ id: 'ORDER1', status: 'COMPLETED' });
    const gw = new PaypalGateway({ accessToken: 'tok', fetch });
    const res = await gw.charge({ amountCents: 1599, currency: 'usd', reference: 'order-9' });
    assert.equal(calls[0]!.url, 'https://api-m.paypal.com/v2/checkout/orders');
    assert.equal(calls[0]!.init.headers['authorization'], 'Bearer tok');
    const body = JSON.parse(calls[0]!.init.body);
    assert.equal(body.purchase_units[0].amount.value, '15.99');
    assert.equal(body.purchase_units[0].amount.currency_code, 'USD');
    assert.deepEqual(res, { id: 'ORDER1', status: 'succeeded' });
  });

  it('requires an access token and rejects incomplete orders', async () => {
    assert.throws(() => new PaypalGateway({ accessToken: '' } as never), /accessToken is required/);
    const { fetch } = stub({ id: 'O', status: 'VOIDED' });
    const gw = new PaypalGateway({ accessToken: 't', fetch });
    await assert.rejects(() => gw.charge({ amountCents: 100, currency: 'USD', reference: 'r' }), PaymentError);
  });

  it('refunds a capture', async () => {
    const { fetch, calls } = stub({ id: 'REF', status: 'COMPLETED' });
    const gw = new PaypalGateway({ accessToken: 't', fetch });
    await gw.refund('CAPTURE123');
    assert.equal(calls[0]!.url, 'https://api-m.paypal.com/v2/payments/captures/CAPTURE123/refund');
  });
});
