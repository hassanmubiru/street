#!/usr/bin/env node
// dast/start-target.mjs
// Minimal Street app used as the DAST scan target in CI. Serves the routes
// declared in dast/routes.json (/health, /users, /users/:id) so Schemathesis
// and OWASP ZAP have a live, OpenAPI-conformant target to exercise. No database
// or external dependencies — it is a security-scan fixture, not a sample app.
//
// Usage: PORT=8080 node dast/start-target.mjs

import { streetApp } from '@streetjs/core';

const port = Number(process.env.PORT ?? 8080);
const app = streetApp({});

// Lightweight router middleware matching dast/routes.json. Always returns a
// well-formed response (never 5xx) so a clean scan passes the gate.
app.use(async (ctx, next) => {
  const path = ctx.path ?? ctx.req?.url ?? '/';
  if (path === '/health') { ctx.json({ status: 'ok' }); return; }
  if (path === '/users') { ctx.json({ users: [] }); return; }
  if (/^\/users\/[^/]+$/.test(path)) {
    const id = path.split('/')[2];
    ctx.json({ id, name: 'probe-user' });
    return;
  }
  await next(); // fall through to 404
});

await app.listen(port, '0.0.0.0');
console.log(`[dast-target] listening on http://0.0.0.0:${port}`);

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => { app.close().finally(() => process.exit(0)); });
}
