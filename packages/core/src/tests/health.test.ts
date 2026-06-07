// src/tests/health.test.ts
// Tests for the Health Check DSL (HealthCheckRegistry, registerHealthRoutes).

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:http';

import { HealthCheckRegistry, registerHealthRoutes } from '../observability/health.js';
import { streetApp } from '../http/server.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

function get(port: number, path: string, attempt = 0): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = request(
      { hostname: '127.0.0.1', port, path, method: 'GET' },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () =>
          resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString() }),
        );
      },
    );
    req.on('error', (err: NodeJS.ErrnoException) => {
      // Retry only transient connection-level errors (server bind race under
      // heavy parallel test load); real HTTP-status assertions are unaffected.
      if ((err.code === 'ECONNREFUSED' || err.code === 'ECONNRESET') && attempt < 5) {
        setTimeout(() => { get(port, path, attempt + 1).then(resolve, reject); }, 25 * (attempt + 1));
      } else {
        reject(err);
      }
    });
    req.end();
  });
}

// Randomize the base port per run to avoid colliding with sockets left in
// TIME_WAIT by a previous run on the same machine.
let testPort = 54200 + Math.floor(Math.random() * 500);
function nextPort(): number { return testPort++; }

// ── HealthCheckRegistry unit tests ────────────────────────────────────────────

describe('HealthCheckRegistry', () => {
  it('returns ok with all up checks', async () => {
    const registry = new HealthCheckRegistry();
    registry.addCheck('db', async () => ({ status: 'up' }));
    registry.addCheck('cache', async () => ({ status: 'up' }));

    const result = await registry.runLiveness();
    assert.equal(result.status, 'ok');
    assert.equal(result.checks['db']?.status, 'up');
    assert.equal(result.checks['cache']?.status, 'up');
    assert.ok(typeof result.checks['db']?.durationMs === 'number');
  });

  it('returns degraded when any check is down', async () => {
    const registry = new HealthCheckRegistry();
    registry.addCheck('db', async () => ({ status: 'up' }));
    registry.addCheck('broken', async () => ({ status: 'down', details: { reason: 'unreachable' } }));

    const result = await registry.runLiveness();
    assert.equal(result.status, 'degraded');
    assert.equal(result.checks['broken']?.status, 'down');
    assert.deepEqual(result.checks['broken']?.details, { reason: 'unreachable' });
  });

  it('marks check as down when it times out', async () => {
    const registry = new HealthCheckRegistry();
    // Track the pending timer so we can await it after runLiveness() returns,
    // ensuring the event loop drains before the next test runs.
    let resolveDelay!: () => void;
    const delayDrained = new Promise<void>((r) => { resolveDelay = r; });

    registry.addCheck(
      'slow',
      () => new Promise<{ status: 'up' | 'down' }>((resolve) => {
        // Short delay so the promise always settles, but long enough for the
        // 15ms health timeout to fire first. Resolve the outer sentinel too.
        setTimeout(() => {
          resolve({ status: 'up' });
          resolveDelay();
        }, 100);
      }),
      { timeoutMs: 15 },
    );

    const result = await registry.runLiveness();
    // Wait for the check's timer to fire so the event loop drains cleanly.
    await delayDrained;

    assert.equal(result.status, 'degraded');
    assert.equal(result.checks['slow']?.status, 'down');
    assert.deepEqual(result.checks['slow']?.details, { reason: 'timeout' });
  });

  it('marks check as down when it throws', async () => {
    const registry = new HealthCheckRegistry();
    registry.addCheck('throws', async () => { throw new Error('connection refused'); });

    const result = await registry.runLiveness();
    assert.equal(result.status, 'degraded');
    assert.equal(result.checks['throws']?.status, 'down');
    assert.equal(
      (result.checks['throws']?.details as Record<string, unknown>)?.['error'],
      'connection refused',
    );
  });

  it('separates liveness and readiness checks', async () => {
    const registry = new HealthCheckRegistry();
    registry.addCheck('live-check', async () => ({ status: 'up' }), { type: 'liveness' });
    registry.addCheck('ready-check', async () => ({ status: 'down' }), { type: 'readiness' });

    const liveness = await registry.runLiveness();
    const readiness = await registry.runReadiness();

    assert.ok('live-check' in liveness.checks);
    assert.ok(!('ready-check' in liveness.checks));
    assert.equal(liveness.status, 'ok');

    assert.ok('ready-check' in readiness.checks);
    assert.ok(!('live-check' in readiness.checks));
    assert.equal(readiness.status, 'degraded');
  });

  it('defaults type to liveness when not specified', async () => {
    const registry = new HealthCheckRegistry();
    registry.addCheck('implicit-live', async () => ({ status: 'up' }));
    const liveness = await registry.runLiveness();
    assert.ok('implicit-live' in liveness.checks);
  });
});

// ── registerHealthRoutes integration tests ────────────────────────────────────

describe('registerHealthRoutes', () => {
  it('GET /health/live returns 200 when all checks are up', async () => {
    const port = nextPort();
    const registry = new HealthCheckRegistry();
    registry.addCheck('db', async () => ({ status: 'up' }), { type: 'liveness' });

    const app = streetApp({ port });
    registerHealthRoutes(app, registry);
    await app.listen(port);
    try {
      const { status, body } = await get(port, '/health/live');
      assert.equal(status, 200);
      const parsed = JSON.parse(body) as { status: string };
      assert.equal(parsed.status, 'ok');
    } finally {
      await app.close();
    }
  });

  it('GET /health/live returns 503 when a check is down', async () => {
    const port = nextPort();
    const registry = new HealthCheckRegistry();
    registry.addCheck('db', async () => ({ status: 'down', details: { reason: 'unreachable' } }), {
      type: 'liveness',
    });

    const app = streetApp({ port });
    registerHealthRoutes(app, registry);
    await app.listen(port);
    try {
      const { status, body } = await get(port, '/health/live');
      assert.equal(status, 503);
      const parsed = JSON.parse(body) as { status: string; checks: Record<string, unknown> };
      assert.equal(parsed.status, 'degraded');
      assert.ok('db' in parsed.checks);
    } finally {
      await app.close();
    }
  });

  it('GET /health/ready returns 200 when all readiness checks are up', async () => {
    const port = nextPort();
    const registry = new HealthCheckRegistry();
    registry.addCheck('migration', async () => ({ status: 'up' }), { type: 'readiness' });

    const app = streetApp({ port });
    registerHealthRoutes(app, registry);
    await app.listen(port);
    try {
      const { status } = await get(port, '/health/ready');
      assert.equal(status, 200);
    } finally {
      await app.close();
    }
  });

  it('GET /health/ready returns 503 when a readiness check is down', async () => {
    const port = nextPort();
    const registry = new HealthCheckRegistry();
    registry.addCheck('migration', async () => ({ status: 'down' }), { type: 'readiness' });

    const app = streetApp({ port });
    registerHealthRoutes(app, registry);
    await app.listen(port);
    try {
      const { status } = await get(port, '/health/ready');
      assert.equal(status, 503);
    } finally {
      await app.close();
    }
  });

  it('non-health routes pass through to not-found handler', async () => {
    const port = nextPort();
    const registry = new HealthCheckRegistry();
    const app = streetApp({ port });
    registerHealthRoutes(app, registry);
    await app.listen(port);
    try {
      const { status } = await get(port, '/api/users');
      assert.equal(status, 404);
    } finally {
      await app.close();
    }
  });
});
