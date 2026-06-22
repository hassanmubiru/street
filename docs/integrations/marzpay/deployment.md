---
layout: default
title: "MarzPay: Deployment"
parent: Integrations
nav_exclude: true
description: "Deploy MarzPay with StreetJS — single base URL, account-driven sandbox/production mode, environment-only credentials, HTTPS callbacks, and a safe production cutover."
---

# MarzPay: Deployment

This page covers taking a MarzPay integration to production. It reflects the
verified environment model from the [research artifact](../marzpay-research.md)
(§V8, §V9): there is a **single base URL**, and sandbox versus production is
**determined by your account/API key**, not by a different host.

## One base URL, account-driven mode

MarzPay uses the same base URL and the same endpoints for both sandbox and
production. Sandbox mode is enabled by default on signup and auto-detected from
your business settings. Your account moves to live once business verification is
complete — the base address never changes.

The plugin still accepts and validates an `environment` selection so your config
is explicit, but it does not switch hosts:

```ts
import { MarzPayPlugin } from '@streetjs/plugin-marzpay';

function requireEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.trim() === '') {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export const marzpayPlugin = MarzPayPlugin({
  apiKey: requireEnv('MARZPAY_API_KEY'),
  secretKey: requireEnv('MARZPAY_SECRET'),
  environment: requireEnv('MARZPAY_ENVIRONMENT') === 'production' ? 'production' : 'sandbox',
  timeoutMs: 30000,
});
```

## Detect sandbox at runtime, not by host

Because the host is identical, detect sandbox from response signals rather than
assuming it from configuration. Verified sandbox signals include
`metadata.sandbox_mode: true` and a `transaction.status` of `sandbox`, with
provider references like `SANDBOX_{PROVIDER}_{TIMESTAMP}`. The plugin's parsed
results expose the transaction status you can check:

```ts
import type { MarzPayClient, PaymentStatus } from '@streetjs/plugin-marzpay';

export async function looksLikeSandbox(marzpay: MarzPayClient, reference: string): Promise<boolean> {
  const status: PaymentStatus = await marzpay.verifyPayment(reference);
  return status.status === 'sandbox';
}
```

## Credentials and configuration

- Store `MARZPAY_API_KEY` and `MARZPAY_SECRET` in environment variables or your
  platform's secret manager. Never commit them.
- Rotate keys periodically; the dashboard shows a key once at creation.
- Set a sensible `timeoutMs` (default `30000`) for your platform's latency.

A missing/empty credential or an invalid `environment` value raises a
configuration error during install that names the offending field, and no client
is injected — so a misconfigured deployment fails fast at startup rather than at
first payment.

## HTTPS callbacks

Webhook callback URLs must be HTTPS and reachable from MarzPay. Use an
unguessable per-tenant path and return HTTP 200 quickly. Because MarzPay
publishes no signature scheme, your handler must re-verify each event server-side
via `getTransaction` before mutating billing state — see
[Webhooks](./webhooks.md).

```ts
function callbackUrl(): string {
  const base = process.env.PUBLIC_BASE_URL;
  if (base === undefined || !base.startsWith('https://')) {
    throw new Error('PUBLIC_BASE_URL must be set to an https:// origin for MarzPay callbacks');
  }
  return `${base}/webhooks/marzpay`;
}
```

## Production cutover checklist

1. Complete MarzPay business verification so your account is live.
2. Swap in your production API key/secret via environment variables.
3. Set `MARZPAY_ENVIRONMENT=production` for an explicit, documented config.
4. Confirm callback URLs are HTTPS and publicly reachable.
5. Verify a small live collection end to end with `verifyPayment`.
6. Confirm webhook handling re-verifies via `getTransaction` and is idempotent on
   `transaction.reference`.

## Region and currency

MarzPay is Uganda-only and settles in UGX, with collection amounts bounded to
500–10,000,000 UGX. Validate amounts and currency before initializing a payment;
do not assume multi-currency or multi-country support.

See [Security](./security.md) for the hardening checklist and
[SaaS Billing](./saas-billing.md) for the `--with-marzpay` starter wiring.
