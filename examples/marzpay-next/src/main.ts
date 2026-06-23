// examples/marzpay-next/src/main.ts
// StreetJS backend for the MarzPay Next.js (App Router) frontend example.
//
// This is the Next.js frontend example: a Next App Router app under `web/` calls
// THIS StreetJS backend. MarzPay credentials and the MarzPayClient live ONLY on
// the backend (and the Next server-side webhook route) — the browser holds none.
// It mirrors the `--frontend next` MarzPay overlay (scaffoldNextMarzPay,
// `web/app/lib/marzpay.ts` + App Router routes) and
// docs/integrations/marzpay/next-example.md.
//
// MarzPay is invoked ONLY through @streetjs/plugin-marzpay (Requirement 13.3):
// the plugin injects a MarzPayClient onto `ctx.state.marzpay` and every operation
// (initializePayment / verifyPayment) goes through that injected client. There is
// NO inline MarzPay HTTP API call anywhere in this example.
//
// Endpoints consumed by the Next client helpers (web/app/lib/marzpay.ts):
//   POST /api/marzpay/initialize        -> initializePayment
//   GET  /api/marzpay/verify/:reference  -> verifyPayment
//   GET  /api/marzpay/subscription       -> active subscription (404 => none)
//   GET  /api/marzpay/invoices           -> invoice history (empty by default)

import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { streetApp, type StreetContext, type SandboxedApp } from 'streetjs';
import { MarzPayPlugin, type MarzPayClient } from '@streetjs/plugin-marzpay';

// ── Startup env-var guard (Requirement 13.5) ───────────────────────────────────
// The backend MarzPay credentials AND the frontend API URL the Next app reads
// (NEXT_PUBLIC_API_URL) are all required. A missing/blank one terminates the
// process with a non-zero status and an error naming the missing variable.

const REQUIRED_ENV_VARS = [
  'MARZPAY_API_KEY',
  'MARZPAY_SECRET',
  'MARZPAY_ENVIRONMENT',
  'NEXT_PUBLIC_API_URL',
] as const;

function requireEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.trim() === '') {
    console.error(`[marzpay-next] Missing required environment variable: ${name}`);
    process.exit(1);
  }
  return value.trim();
}

for (const name of REQUIRED_ENV_VARS) {
  requireEnv(name);
}

const apiKey = requireEnv('MARZPAY_API_KEY');
const secretKey = requireEnv('MARZPAY_SECRET');
const environmentRaw = requireEnv('MARZPAY_ENVIRONMENT');
if (environmentRaw !== 'sandbox' && environmentRaw !== 'production') {
  console.error(
    `[marzpay-next] Invalid MARZPAY_ENVIRONMENT="${environmentRaw}" (expected "sandbox" or "production")`,
  );
  process.exit(1);
}
const environment = environmentRaw;
const port = parseInt(process.env['PORT'] ?? '3000', 10);

// ── App + plugin wiring ─────────────────────────────────────────────────────────

const app = streetApp({ port });
const marzpay = MarzPayPlugin({ apiKey, secretKey, environment, stateKey: 'marzpay' });

// The plugin's `onLoad` expects a SandboxedApp (exposing `use` + `on`).
function sandboxFor(application: typeof app): SandboxedApp {
  return {
    use: (middleware) => application.use(middleware),
    on: () => {},
  };
}

function client(ctx: StreetContext): MarzPayClient {
  return ctx.state['marzpay'] as MarzPayClient;
}

// ── Routes (consumed by web/app/lib/marzpay.ts) ─────────────────────────────────

// POST /api/marzpay/initialize — initialize a payment via the plugin.
app.use(async (ctx, next) => {
  if (ctx.method === 'POST' && ctx.path === '/api/marzpay/initialize') {
    const body = (ctx.body ?? {}) as {
      amount?: unknown;
      currency?: unknown;
      country?: unknown;
      reference?: unknown;
      method?: unknown;
      phone_number?: unknown;
      description?: unknown;
    };
    const amount = typeof body.amount === 'number' ? body.amount : Number(body.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      ctx.json({ error: 'amount is required and must be a positive number' }, 400);
      return;
    }
    const isCard = body.method === 'card';
    const phoneNumber = typeof body.phone_number === 'string' ? body.phone_number : undefined;
    if (!isCard && (phoneNumber === undefined || phoneNumber.trim() === '')) {
      ctx.json({ error: 'provide "phone_number" (mobile money) or set "method" to "card"' }, 400);
      return;
    }
    try {
      const result = await client(ctx).initializePayment({
        amount,
        country: typeof body.country === 'string' && body.country.trim() !== '' ? body.country : 'UG',
        reference:
          typeof body.reference === 'string' && body.reference.trim() !== ''
            ? body.reference
            : randomUUID(),
        ...(isCard ? { method: 'card' as const } : { phone_number: phoneNumber }),
        ...(typeof body.currency === 'string' ? { currency: body.currency } : {}),
        ...(typeof body.description === 'string' ? { description: body.description } : {}),
      });
      ctx.json(result, 200);
    } catch (err) {
      ctx.json({ error: 'payment initialization failed', detail: (err as Error).message }, 502);
    }
    return;
  }
  await next();
});

// GET /api/marzpay/verify/:reference — verify a payment via the plugin.
app.use(async (ctx, next) => {
  if (ctx.method === 'GET' && ctx.path.startsWith('/api/marzpay/verify/')) {
    const reference = decodeURIComponent(ctx.path.slice('/api/marzpay/verify/'.length));
    if (reference === '') {
      ctx.json({ error: 'reference is required' }, 400);
      return;
    }
    try {
      const status = await client(ctx).verifyPayment(reference);
      ctx.json(status, 200);
    } catch (err) {
      ctx.json({ error: 'payment verification failed', detail: (err as Error).message }, 502);
    }
    return;
  }
  await next();
});

// GET /api/marzpay/subscription — active subscription for the SubscriptionSection.
// No active subscription is modelled here, so the backend returns 404; the Next
// client helper maps 404 to `null` and the UI renders its empty-state. A real app
// would read the subscription from its own org-scoped store (see marzpay-saas).
app.use(async (ctx, next) => {
  if (ctx.method === 'GET' && ctx.path === '/api/marzpay/subscription') {
    ctx.json({ error: 'no active subscription' }, 404);
    return;
  }
  await next();
});

// GET /api/marzpay/invoices — invoice history for the InvoiceHistory section.
app.use(async (ctx, next) => {
  if (ctx.method === 'GET' && ctx.path === '/api/marzpay/invoices') {
    ctx.json([], 200);
    return;
  }
  await next();
});

// ── Start ─────────────────────────────────────────────────────────────────────

async function bootstrap(): Promise<void> {
  await marzpay.onInstall();
  await marzpay.onLoad(sandboxFor(app));
  await app.listen(port, '0.0.0.0');
  console.log(`▲ MarzPay Next.js backend running on http://localhost:${port} (env: ${environment})`);
  console.log('   Start the Next.js frontend with: npm --prefix web run dev');
}

bootstrap().catch((err) => {
  console.error('[marzpay-next] failed to start:', (err as Error).message);
  process.exit(1);
});
