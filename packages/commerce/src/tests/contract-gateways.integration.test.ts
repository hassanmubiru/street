// contract-gateways.integration.test.ts
// Live contract tests for the real payment gateways. Gated on credentials so
// the suite skips cleanly without secrets and runs a minimal real call when a
// maintainer supplies them. Use TEST-mode credentials (Stripe sk_test_...,
// PayPal sandbox token) — these calls do not move real money.
//
//   STRIPE_SECRET_KEY=sk_test_... npm run test -w packages/commerce
//   PAYPAL_ACCESS_TOKEN=... PAYPAL_BASE_URL=https://api-m.sandbox.paypal.com \
//     npm run test -w packages/commerce

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { StripeGateway, PaypalGateway, PaymentError } from '../index.js';

const STRIPE = process.env['STRIPE_SECRET_KEY'];
const PAYPAL = process.env['PAYPAL_ACCESS_TOKEN'];

describe('Stripe contract', { skip: !STRIPE ? 'STRIPE_SECRET_KEY not set' : false }, () => {
  it('authenticates and parses the PaymentIntent response shape', async () => {
    const gw = new StripeGateway({ apiKey: STRIPE });
    // A bare confirmed PaymentIntent without a payment method does not succeed.
    // Either outcome proves the contract: the request authenticated and the
    // response parsed. What must NOT happen is an auth (401) or transport error.
    try {
      const res = await gw.charge({ amountCents: 100, currency: 'usd', reference: 'contract-test' });
      assert.match(res.id, /^pi_/, 'a succeeded intent id starts with pi_');
      assert.equal(res.status, 'succeeded');
    } catch (err) {
      assert.ok(err instanceof PaymentError, `expected a structured PaymentError, got ${err}`);
      assert.doesNotMatch((err as Error).message, /401|403/, 'must be authenticated (not an auth error)');
    }
  });
});

describe('PayPal contract', { skip: !PAYPAL ? 'PAYPAL_ACCESS_TOKEN not set' : false }, () => {
  it('authenticates and parses the Orders v2 response shape', async () => {
    const gw = new PaypalGateway({
      accessToken: PAYPAL!,
      baseUrl: process.env['PAYPAL_BASE_URL'] ?? 'https://api-m.sandbox.paypal.com',
    });
    // A freshly created order is CREATED (not COMPLETED), so charge throws a
    // structured PaymentError — proving the token authenticated and the
    // response parsed. An auth failure would surface as an API error instead.
    try {
      const res = await gw.charge({ amountCents: 150, currency: 'USD', reference: 'contract-test' });
      assert.equal(res.status, 'succeeded');
    } catch (err) {
      assert.ok(err instanceof PaymentError, `expected a structured PaymentError, got ${err}`);
      assert.doesNotMatch((err as Error).message, /401|403/, 'must be authenticated (not an auth error)');
    }
  });
});
