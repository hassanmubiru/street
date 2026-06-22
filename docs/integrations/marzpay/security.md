---
layout: default
title: "MarzPay: Security"
parent: Integrations
nav_exclude: true
description: "Secure a MarzPay integration — HTTPS, Basic-auth credential handling, environment-only secrets, account controls, and the documented webhook trust path via re-verification."
---

# MarzPay: Security

This page collects the verified security requirements from the
[research artifact](../marzpay-research.md) (§V10) and the documented webhook
trust path (§R1). It describes only behaviors MarzPay documents.

## Transport and authentication

- **HTTPS everywhere.** All MarzPay traffic is encrypted over HTTPS.
- **HTTP Basic auth.** The plugin authenticates with
  `Authorization: Basic base64(apiKey:secretKey)` and
  `Content-Type: application/json`. Credentials are sent only as that header,
  over HTTPS, and are never placed in URLs or query strings.

The auth header is constructed for you by the plugin; you never build it by hand:

```ts
import { MarzPayPlugin } from '@streetjs/plugin-marzpay';

function requireEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.trim() === '') {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

// The plugin derives the Basic-auth header from these credentials internally.
export const marzpayPlugin = MarzPayPlugin({
  apiKey: requireEnv('MARZPAY_API_KEY'),
  secretKey: requireEnv('MARZPAY_SECRET'),
});
```

## API key handling

- **Never expose keys client-side.** Keep the `MarzPayClient` on the server; the
  browser calls your endpoints, not MarzPay directly (see the
  [React](./react-example.md) and [Next](./next-example.md) examples).
- **Never commit keys.** Store them in environment variables or a secret manager.
- **Rotate regularly.** The dashboard shows a key once at creation.
- **IP allowlisting** is offered by MarzPay — restrict API access to your server
  egress addresses where possible.

Never log secrets. When logging requests, log the operation and reference, not
the `Authorization` header or raw credentials.

## Account controls

MarzPay documents these account-level protections; enable them on your business
account:

- **Two-factor authentication** (TOTP via an authenticator app).
- **Role-based access** (Business Owner / Team Member with granular permissions).
- **Login alerts** and full **activity/audit logs**.

## Webhook trust: re-verify, do not trust the payload

MarzPay documents webhook **delivery and payload** but **no signature scheme** —
no header, algorithm, encoding, or signing secret. So:

- `validateWebhook(rawBody, signature)` returns **false** for absent, empty, or
  malformed signature material — there is no verified positive path via signature
  against an undocumented scheme.
- The documented, verifiable trust path is **server-side re-verification**: on
  each webhook, re-fetch the transaction with `getTransaction` and trust the
  server's amount/status/reference, not the raw POST body.

```ts
import type { MarzPayClient, Transaction } from '@streetjs/plugin-marzpay';

/** Confirm a webhook event by re-fetching the transaction from MarzPay. */
export async function confirmEvent(marzpay: MarzPayClient, reference: string): Promise<boolean> {
  const txn: Transaction = await marzpay.getTransaction(reference);
  return txn.status === 'completed' || txn.status === 'successful';
}
```

Pair re-verification with:

- **HTTPS-only** callback endpoints.
- **Unguessable** per-tenant callback URLs.
- **Idempotency** keyed on `transaction.reference` so retries cannot double-apply.

## Tenant isolation (SaaS)

In multi-tenant apps, persist and read billing data only through org-scoped
repositories so every record is stamped and filtered by the active tenant's
`org_id`. A payload can never override the `org_id`, and one tenant's records are
never returned for another. See [SaaS Billing](./saas-billing.md).

## What is intentionally not implemented

To honor verify-don't-invent, these undocumented behaviors are not implemented
and must not be assumed:

- **No webhook signature verification scheme** — use re-verification instead.
- **No refunds** — the client's `refund` rejects with an "unsupported" error.
- **No native subscriptions or recurring billing** — compose cycles from explicit
  collections (see [Subscriptions](./subscriptions.md)).
