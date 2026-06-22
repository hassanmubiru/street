# StreetJS — MarzPay SaaS Billing Example

A multi-tenant SaaS billing app built with StreetJS and the official
[`@streetjs/plugin-marzpay`](../../packages/plugin-marzpay) plugin. It mirrors
the `street create my-app --starter saas --with-marzpay` scaffold pattern: a
config-driven, org-scoped `BillingService` with a checkout route and a webhook
route.

MarzPay is invoked **only** through the plugin (`initializePayment`,
`getTransaction`, `validateWebhook`) — there is no inline MarzPay HTTP API call.

Key behaviors:

- **Config-driven plans** — plans are read from `billingConfig`, never hardcoded
  into request logic; an unknown plan id is rejected without persisting.
- **Tenant isolation** — every billing record is scoped to the active org
  (`x-org-id` header); a record created for one tenant is never returned in a
  query made on behalf of another.
- **Validate-before-persist webhooks** — the webhook route calls
  `validateWebhook` on the raw body **before** any persistence; a negative
  result returns `webhook validation failed` and writes nothing. Because MarzPay
  documents no webhook signature scheme, the positive path relies on documented
  server-side re-verification via `getTransaction`.

## Required environment variables

The app checks these at startup. If any is unset (or blank) the process exits
with a non-zero status and prints the name of the missing variable.

| Variable | Required | Description |
|----------|:--------:|-------------|
| `MARZPAY_API_KEY` | yes | MarzPay API key (Basic-auth user) |
| `MARZPAY_SECRET` | yes | MarzPay API secret (Basic-auth password) |
| `MARZPAY_ENVIRONMENT` | yes | `sandbox` or `production` |
| `PORT` | no | HTTP port (default `3002`) |

## Run

```bash
npm install
npm run build
MARZPAY_API_KEY=your-key \
MARZPAY_SECRET=your-secret \
MARZPAY_ENVIRONMENT=sandbox \
npm start
```

## Endpoints

All billing endpoints require an `x-org-id` header identifying the active tenant.

- `POST /billing/checkout` — start a checkout for a configured plan.
  Body: `{ "planId": "starter" }`
- `GET /billing/records` — list the active tenant's billing records.
- `POST /webhooks/marzpay` — inbound webhook (validate-before-persist).

```bash
curl -s -X POST http://localhost:3002/billing/checkout \
     -H 'Content-Type: application/json' -H 'x-org-id: org-123' \
     -d '{"planId":"starter"}'

curl -s http://localhost:3002/billing/records -H 'x-org-id: org-123'
```

Configured plans: `starter`, `team`.
