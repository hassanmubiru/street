#!/usr/bin/env node
// scripts/enterprise/e2e.mjs
//
// The Enterprise Console APIs Layer B END-TO-END suite (Requirement 6.10). This
// is the real command executed (through `CommandRunner`) by verify.mjs. It is
// also runnable standalone for local debugging.
//
// What it does, mirroring the design's Enterprise Console surface:
//   1. Starts PostgreSQL IN A CONTAINER (POSTGRES_IMAGE).
//   2. Starts the running app (server.mjs) as a host process pointed at the
//      container, and waits for `/health/ready` (real DB reachability).
//   3. Drives the FULL console surface over HTTP as a real client, tallying
//      passed / failed test counts across:
//        • authentication gating  — no/invalid token ⇒ 401 (Req 6.6)
//        • authorization gating   — wrong-role token ⇒ 403 (Req 6.7)
//        • input validation       — malformed input ⇒ 400, state unchanged (Req 6.8)
//        • happy-path operations  — tenant / policy / compliance / admin (Req 6.1–6.4)
//   4. Writes a machine-readable summary (`enterprise.api.summary.json`) with the
//      passed/failed counts so verify.mjs can fold them into the Verification
//      Artifact (Req 6.10).
//   5. Tears the container + app down.
//
// Exit code: 0 when every test passes, non-zero when any test fails. When NO
// container runtime is available the suite prints a SKIP line and exits 0 — the
// driver's prerequisite probe records the honest BLOCKED status, so the offline
// suite stays green (Testing Strategy → Honest BLOCKED).
//
// _Design: Components → Enterprise Console APIs; Testing Strategy → Layer B.
//  Requirements: 6.1–6.10_

import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { JwtService } from 'streetjs';

import {
  POSTGRES_IMAGE,
  REPO_ROOT,
  PG,
  CONSOLE_JWT_SECRET,
  probeContainerPrerequisites,
  findFreePort,
  waitForHttp,
  waitForPostgres,
  docker,
} from './lib.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SERVER_SCRIPT = resolve(HERE, 'server.mjs');
const SUMMARY_DIR = resolve(REPO_ROOT, 'verification-artifacts', 'enterprise');
const SUMMARY_PATH = resolve(SUMMARY_DIR, 'enterprise.api.summary.json');

const jwt = new JwtService(CONSOLE_JWT_SECRET);

/** Mint a Bearer token carrying the given roles (1h expiry). */
function token(roles) {
  return jwt.sign({ sub: 'tester', email: 'tester@street.dev', roles }, { expiresInSeconds: 3600 });
}

/** Write the suite summary so the verify driver can fold counts into the artifact. */
function writeSummary(summary) {
  mkdirSync(SUMMARY_DIR, { recursive: true });
  writeFileSync(SUMMARY_PATH, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
}

/** Start the PostgreSQL container; returns the container name + mapped host port. */
async function startPostgres() {
  const hostPort = await findFreePort();
  const name = `street-enterprise-pg-${process.pid}`;
  const run = docker([
    'run', '--rm', '-d',
    '--name', name,
    '-p', `127.0.0.1:${hostPort}:5432`,
    '-e', `POSTGRES_USER=${PG.user}`,
    '-e', `POSTGRES_PASSWORD=${PG.password}`,
    '-e', `POSTGRES_DB=${PG.database}`,
    POSTGRES_IMAGE,
  ]);
  if (!run.ok) {
    throw new Error(`failed to start postgres container: ${run.stderr || run.stdout}`);
  }
  return { name, hostPort };
}

/** Start the running app (server.mjs) pointed at the container; returns child + baseUrl. */
async function startServer(pgPort) {
  const appPort = await findFreePort();
  const child = spawn('node', [SERVER_SCRIPT], {
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      HOST: '127.0.0.1',
      PORT: String(appPort),
      PGHOST: '127.0.0.1',
      PGPORT: String(pgPort),
      STREET_CONSOLE_JWT_SECRET: CONSOLE_JWT_SECRET,
    },
    stdio: ['ignore', 'inherit', 'inherit'],
  });
  return { child, baseUrl: `http://127.0.0.1:${appPort}` };
}

/** A minimal HTTP helper returning `{ status, body }`. */
async function call(baseUrl, method, path, { auth, body } = {}) {
  const headers = { 'content-type': 'application/json' };
  if (auth) headers.authorization = `Bearer ${auth}`;
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  let parsed;
  try {
    parsed = await res.json();
  } catch {
    parsed = undefined;
  }
  return { status: res.status, body: parsed };
}

async function runSuite(baseUrl) {
  const results = [];
  const adminTok = token(['admin']);
  const wrongTok = token(['nobody']); // authenticated but unauthorized for any op

  /** Run one named check; record pass/fail without throwing. */
  async function check(name, fn) {
    try {
      const ok = await fn();
      results.push({ name, passed: ok === true });
      console.log(`[enterprise-e2e] ${ok === true ? 'PASS' : 'FAIL'} — ${name}`);
    } catch (err) {
      results.push({ name, passed: false, error: String(err?.message ?? err) });
      console.log(`[enterprise-e2e] FAIL — ${name}: ${err?.message ?? err}`);
    }
  }

  // ── Authentication gating (Req 6.6): no/invalid token ⇒ 401 ──────────────────
  await check('createTenant without a token is 401', async () => {
    const r = await call(baseUrl, 'POST', '/api/admin/tenants', { body: { name: 'acme', plan: 'pro' } });
    return r.status === 401;
  });
  await check('createTenant with a forged token is 401', async () => {
    const forged = new JwtService('a-totally-different-secret-9876543210-xyz').sign({ sub: 'x', roles: ['admin'] });
    const r = await call(baseUrl, 'POST', '/api/admin/tenants', { auth: forged, body: { name: 'acme' } });
    return r.status === 401;
  });

  // ── Authorization gating (Req 6.7): authenticated but wrong role ⇒ 403 ───────
  await check('createTenant with an unauthorized role is 403', async () => {
    const r = await call(baseUrl, 'POST', '/api/admin/tenants', { auth: wrongTok, body: { name: 'acme' } });
    return r.status === 403;
  });
  await check('rotateKey with an unauthorized role is 403', async () => {
    const r = await call(baseUrl, 'POST', '/api/admin/keys/rotate', { auth: wrongTok, body: { keyId: 'k1' } });
    return r.status === 403;
  });

  // ── Input validation (Req 6.8): malformed input ⇒ 400, state unchanged ───────
  await check('createTenant with a missing name is 400', async () => {
    const r = await call(baseUrl, 'POST', '/api/admin/tenants', { auth: adminTok, body: { plan: 'pro' } });
    return r.status === 400 && typeof r.body?.field === 'string';
  });
  await check('setRetentionPolicy with a negative retention is 400', async () => {
    const r = await call(baseUrl, 'PUT', '/api/admin/policies/retention', { auth: adminTok, body: { entity: 'logs', retentionDays: -5 } });
    return r.status === 400;
  });
  await check('rejected createTenant leaves tenant count unchanged', async () => {
    const before = await call(baseUrl, 'GET', '/api/admin/compliance/posture', { auth: adminTok });
    await call(baseUrl, 'POST', '/api/admin/tenants', { auth: adminTok, body: {} }); // invalid → rejected
    const after = await call(baseUrl, 'GET', '/api/admin/compliance/posture', { auth: adminTok });
    return before.body?.tenantCount === after.body?.tenantCount;
  });

  // ── Tenant happy path (Req 6.1) ──────────────────────────────────────────────
  let tenantId;
  await check('createTenant returns 201 with an id', async () => {
    const r = await call(baseUrl, 'POST', '/api/admin/tenants', { auth: adminTok, body: { name: 'acme', plan: 'pro' } });
    tenantId = r.body?.id;
    return r.status === 201 && typeof tenantId === 'string' && tenantId.length > 0;
  });
  await check('updateTenant returns 200', async () => {
    const r = await call(baseUrl, 'PATCH', `/api/admin/tenants/${tenantId}`, { auth: adminTok, body: { plan: 'enterprise' } });
    return r.status === 200;
  });
  await check('suspendTenant returns 200 with suspended status', async () => {
    const r = await call(baseUrl, 'POST', `/api/admin/tenants/${tenantId}/suspend`, { auth: adminTok });
    return r.status === 200 && r.body?.status === 'suspended';
  });
  await check('updateTenant for an unknown id is 404', async () => {
    const r = await call(baseUrl, 'PATCH', '/api/admin/tenants/00000000-0000-0000-0000-000000000000', { auth: adminTok, body: { plan: 'x' } });
    return r.status === 404;
  });

  // ── Policy happy path (Req 6.2) ──────────────────────────────────────────────
  await check('setRbacPolicy returns 200', async () => {
    const r = await call(baseUrl, 'PUT', '/api/admin/policies/rbac', { auth: adminTok, body: { roles: [{ role: 'admin', permissions: ['*'] }] } });
    return r.status === 200;
  });
  await check('setMfaPolicy returns 200', async () => {
    const r = await call(baseUrl, 'PUT', '/api/admin/policies/mfa', { auth: adminTok, body: { required: true } });
    return r.status === 200;
  });
  await check('setRetentionPolicy returns 200', async () => {
    const r = await call(baseUrl, 'PUT', '/api/admin/policies/retention', { auth: adminTok, body: { entity: 'audit', retentionDays: 365 } });
    return r.status === 200;
  });
  await check('setClassificationPolicy returns 200', async () => {
    const r = await call(baseUrl, 'PUT', '/api/admin/policies/classification', { auth: adminTok, body: { field: 'email', level: 'confidential' } });
    return r.status === 200;
  });

  // ── Compliance happy path (Req 6.3) ──────────────────────────────────────────
  await check('exportAudit returns 200 with a format', async () => {
    const r = await call(baseUrl, 'GET', '/api/admin/compliance/audit-export?from=2024-01-01T00:00:00Z&to=2024-12-31T00:00:00Z&format=jsonl', { auth: adminTok });
    return r.status === 200 && r.body?.format === 'jsonl';
  });
  await check('generateComplianceReport reflects persisted classification policy', async () => {
    const r = await call(baseUrl, 'GET', '/api/admin/compliance/report', { auth: adminTok });
    return r.status === 200 && Array.isArray(r.body?.entries) && r.body.entries.some((e) => e.field === 'email');
  });
  await check('securityPosture reflects persisted MFA policy', async () => {
    const r = await call(baseUrl, 'GET', '/api/admin/compliance/posture', { auth: adminTok });
    return r.status === 200 && r.body?.mfaRequired === true && r.body?.rbacConfigured === true;
  });

  // ── Admin happy path (Req 6.4) ───────────────────────────────────────────────
  await check('manageUser returns 200', async () => {
    const r = await call(baseUrl, 'POST', '/api/admin/users', { auth: adminTok, body: { action: 'create', userId: 'u1', roles: ['viewer'] } });
    return r.status === 200 && r.body?.userId === 'u1';
  });
  await check('rotateKey returns 200 with a timestamp', async () => {
    const r = await call(baseUrl, 'POST', '/api/admin/keys/rotate', { auth: adminTok, body: { keyId: 'signing-key' } });
    return r.status === 200 && typeof r.body?.rotatedAt === 'string';
  });
  await check('manageSecret returns 200', async () => {
    const r = await call(baseUrl, 'PUT', '/api/admin/secrets/db-password', { auth: adminTok, body: { value: 's3cr3t' } });
    return r.status === 200 && r.body?.name === 'db-password';
  });

  const passed = results.filter((r) => r.passed).length;
  const failed = results.length - passed;
  return { total: results.length, passed, failed, results };
}

async function runE2E() {
  const pg = await startPostgres();
  let server;
  try {
    const pgReady = await waitForPostgres(pg.name, { timeoutMs: 60_000 });
    if (!pgReady) throw new Error('postgres container did not become ready within 60s');

    server = await startServer(pg.hostPort);

    // Wait for the running app's DB-readiness endpoint (200 only when the DB is reachable).
    const ready = await waitForHttp(`${server.baseUrl}/health/ready`, { timeoutMs: 60_000, expectStatuses: [200] });
    if (!ready) throw new Error('running app /health/ready did not return 200 within 60s');

    const summary = await runSuite(server.baseUrl);
    writeSummary({ ...summary, status: summary.failed === 0 ? 'passed' : 'failed', timestamp: new Date().toISOString() });

    console.log(`[enterprise-e2e] suite complete — ${summary.passed}/${summary.total} passed, ${summary.failed} failed`);
    return summary.failed === 0;
  } finally {
    if (server?.child) {
      server.child.kill('SIGTERM');
    }
    docker(['stop', '-t', '3', pg.name], { timeoutMs: 30_000 });
  }
}

async function main() {
  // When no container runtime is available, SKIP cleanly (exit 0). The driver's
  // prerequisite probe records the honest BLOCKED status for the artifact.
  const missing = probeContainerPrerequisites();
  if (missing) {
    console.log(`[enterprise-e2e] SKIP — container unavailable: ${missing.kind}/${missing.missingPrerequisite}`);
    writeSummary({ total: 0, passed: 0, failed: 0, results: [], status: 'skipped', skipped: missing, timestamp: new Date().toISOString() });
    process.exitCode = 0;
    return;
  }

  try {
    const ok = await runE2E();
    process.exitCode = ok ? 0 : 1;
  } catch (err) {
    console.error(`[enterprise-e2e] FAILED: ${err instanceof Error ? err.message : String(err)}`);
    writeSummary({ total: 0, passed: 0, failed: 1, results: [], status: 'error', error: String(err?.message ?? err), timestamp: new Date().toISOString() });
    process.exitCode = 1;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  void main();
}

export { token, SUMMARY_PATH };
