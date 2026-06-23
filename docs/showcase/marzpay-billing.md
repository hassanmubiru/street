---
layout:      default
title:       "MarzPay Billing — built with StreetJS"
permalink:   /showcase/marzpay-billing/
nav_exclude: true
description:  "A payments + subscriptions backend built with StreetJS and the published @streetjs/plugin-marzpay — checkout, webhooks, org-scoped billing."
---

# MarzPay Billing — built with StreetJS

**Payments · Subscriptions · Webhooks — on a dependency-free, signed plugin.**

- **Live demo:** _coming soon_ (sandbox only — see the [demo plan](https://github.com/hassanmubiru/StreetJS/blob/main/DEMO-INFRA-PLAN.md))
- **Source:** [`examples/marzpay-saas`](https://github.com/hassanmubiru/StreetJS/tree/main/examples/marzpay-saas) (+ `marzpay-checkout`, `marzpay-subscriptions`, `marzpay-next/react/htmx`)
- **Package:** [`@streetjs/plugin-marzpay`](https://www.npmjs.com/package/@streetjs/plugin-marzpay) (npm — signed + provenance)
- **Deploy:** [`deploy/`](https://github.com/hassanmubiru/StreetJS/tree/main/deploy) · **Docs:** [MarzPay integration](/StreetJS/integrations/marzpay-research/)

## Architecture

```
Customer ─▶ checkout controller ─▶ @streetjs/plugin-marzpay (dependency-free node:https client)
                                        │  initialize payment (SANDBOX)
                                        ▼
                              MarzPay API ──(async)──▶ webhook controller
                                                          ├─ server-side RE-VERIFY (verify by re-query)
                                                          └─ persist org-scoped SubscriptionRecord (PostgreSQL)
```

MarzPay publishes no webhook signature scheme, so the webhook controller does
**server-side re-verification** (re-query the transaction) rather than trusting the
payload — a deliberate, documented security choice from the integration research.

## Run it locally

```bash
npm run build -w packages/core
npm run build -w packages/plugin-marzpay
# pick a variant, e.g. the SaaS billing overlay:
cat examples/marzpay-saas/README.md     # run + required MARZPAY_* (sandbox) env
```

## Variants

| Variant | Focus |
|---|---|
| `marzpay-checkout` | one-shot collection/checkout |
| `marzpay-subscriptions` | recurring billing scaffolding |
| `marzpay-saas` | billing inside the SaaS overlay |
| `marzpay-next` / `marzpay-react` / `marzpay-htmx` | frontend integrations |

## Learning path

1. Checkout (one-shot collection)
2. Subscriptions (recurring)
3. SaaS billing overlay (`--with-marzpay`)
4. Frontend (Next / React / HTMX)

> Sandbox only — no real money moves in the demo. Browse all demos in the
> [Showcase](/StreetJS/showcase/).
