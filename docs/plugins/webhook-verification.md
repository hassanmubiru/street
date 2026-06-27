---
layout:      default
title:       "Webhook Verification"
permalink:   /plugins/webhook-verification/
nav_order:   8
description:  "Verify inbound Stripe and Twilio webhooks in StreetJS with the constant-time verifiers exported from streetjs — no vendor SDK required."
---

{% include doc-styles.html %}

<div class="doc-header">
<span class="dh-label">Plugins</span>
<h1>Webhook verification</h1>
<p>Verify that an inbound webhook genuinely came from the provider before acting
on it. StreetJS exports constant-time verifiers so you don't need a vendor SDK.</p>
</div>

> **Always verify before you trust.** An unverified webhook endpoint lets anyone
> POST forged events (fake payments, fake delivery receipts). Both verifiers below
> use a constant-time comparison and are pure functions — no network call.

> **Use the RAW request body.** Signatures are computed over the exact bytes the
> provider sent. If your framework parses/re-serializes JSON first, the bytes
> change and verification fails. Capture the raw body for the webhook route.

---

## Stripe (`Stripe-Signature`)

`verifyStripeWebhook(rawBody, signatureHeader, signingSecret, toleranceSec?)`
returns `true` only when the HMAC-SHA256 over `${timestamp}.${rawBody}` matches a
`v1` signature **and** the timestamp is within tolerance (default 300s, replay
protection).

```typescript
import { verifyStripeWebhook } from 'streetjs';

// Endpoint signing secret from the Stripe dashboard (whsec_…). Keep it in env.
const STRIPE_WEBHOOK_SECRET = process.env['STRIPE_WEBHOOK_SECRET']!;

async function stripeWebhook(ctx: StreetContext): Promise<void> {
  const raw = ctx.rawBody;                       // the exact bytes Stripe sent
  const sig = ctx.headers['stripe-signature'] ?? '';

  if (!verifyStripeWebhook(raw, sig, STRIPE_WEBHOOK_SECRET)) {
    ctx.status = 400;
    ctx.body = { error: 'invalid signature' };
    return;                                       // reject forged / stale events
  }

  const event = JSON.parse(typeof raw === 'string' ? raw : raw.toString('utf8'));
  // …handle event.type (payment_intent.succeeded, etc.) — now trusted.
  ctx.status = 200;
}
```

Tune the replay window with the 4th argument, e.g. `verifyStripeWebhook(raw, sig,
secret, 600)`. Pass `0` to disable the timestamp check (not recommended).

---

## Twilio (`X-Twilio-Signature`)

`verifyTwilioSignature(authToken, url, params, signature)` returns `true` only
when the HMAC-SHA1 over the **full request URL followed by the POST params in
lexicographic key order** matches the header.

```typescript
import { verifyTwilioSignature } from 'streetjs';

const TWILIO_AUTH_TOKEN = process.env['TWILIO_AUTH_TOKEN']!;

async function twilioWebhook(ctx: StreetContext): Promise<void> {
  // The URL must be EXACTLY what you configured in the Twilio console
  // (scheme + host + path + query), including any proxy-rewritten host.
  const url = `https://${ctx.headers['host']}${ctx.path}`;
  const params = ctx.body as Record<string, string>;   // parsed form fields
  const sig = ctx.headers['x-twilio-signature'] ?? '';

  if (!verifyTwilioSignature(TWILIO_AUTH_TOKEN, url, params, sig)) {
    ctx.status = 403;
    return;                                              // reject forged requests
  }
  // …trusted Twilio callback (SMS status, inbound message, etc.)
  ctx.status = 200;
}
```

> If you terminate TLS at a proxy/load balancer, reconstruct the **original**
> public URL Twilio called (honor `X-Forwarded-Proto` / `X-Forwarded-Host`),
> not the internal one — the signature is computed over the URL Twilio used.

---

## Outbound timeouts

Every official `node:https` plugin (stripe, twilio, sendgrid, auth0, paypal,
openai, clerk, firebase, supabase) accepts an optional `timeoutMs` (default
30000) so a hung upstream fails fast instead of leaking a socket:

```typescript
new StripePlugin({ apiKey: process.env['STRIPE_API_KEY']!, timeoutMs: 10_000 });
```

---

## Status & roadmap

Verifiers ship for **Stripe** and **Twilio** today. PayPal (transmission
cert-chain) and SendGrid (ECDSA event webhook) verifiers are tracked in
[plans/OUTSTANDING-ACTIONS.md](https://github.com/hassanmubiru/StreetJS/blob/main/plans/OUTSTANDING-ACTIONS.md)
(#9). See the [Plugin Maturity Matrix](https://github.com/hassanmubiru/StreetJS/blob/main/audits/PLUGIN-MATURITY-MATRIX.md)
for per-plugin status.
