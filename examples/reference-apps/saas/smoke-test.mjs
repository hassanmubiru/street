// End-to-end smoke test for the SaaS reference app.
//   node examples/reference-apps/saas/smoke-test.mjs

import assert from 'node:assert/strict';
import { createSaas } from './server.mjs';

const app = createSaas();
const { admin } = app;
let failures = 0;
const check = async (n, fn) => { try { await fn(); console.log('  ok  ' + n); } catch (e) { failures++; console.log('  FAIL ' + n + ': ' + e.message); } };

await admin.createRole('system', { name: 'support', permissions: ['users:read', 'tickets:*'] });
const jane = await admin.createUser('system', { email: 'jane@acme.com', roles: ['support'] });

await check('RBAC: wildcard permission granted, others denied', async () => {
  assert.equal(await admin.can(jane.id, 'tickets:close'), true);
  assert.equal(await admin.can(jane.id, 'users:delete'), false);
});
await check('suspension denies all access', async () => {
  await admin.suspendUser('system', jane.id);
  assert.equal(await admin.can(jane.id, 'tickets:close'), false);
});
await check('audit log records every mutation', async () => {
  const events = await admin.auditLog();
  assert.ok(events.some((e) => e.action === 'user.suspend' && e.target === jane.id));
  assert.ok(events.some((e) => e.action === 'role.create'));
});

await app.close();
console.log(failures === 0 ? '\n✅ saas reference app: all checks passed' : `\n❌ ${failures} failed`);
process.exit(failures === 0 ? 0 : 1);
