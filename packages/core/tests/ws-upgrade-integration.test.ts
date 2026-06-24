// tests/ws-upgrade-integration.test.ts
// Integration tests for the WebSocket upgrade path (F-R2 / F-R1 origin gate).
// Uses ONLY node:test + node:assert/strict with a real node:http server and
// StreetWebSocketServer.attach.
//
// Validates: Requirements 3.5, 3.6
//   3.5 — a disallowed Origin rejection terminates the connection WITHOUT
//         emitting a `connection` event (the attach handler is never invoked).
//   3.6 — a non-origin rejection (failing authFn) applies the existing 401
//         behavior unchanged; the no-`connection`-event rule is scoped to
//         origin rejections.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request as httpRequest, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { randomBytes } from 'node:crypto';

import { StreetWebSocketServer, type WsServerOptions } from '../src/websocket/server.js';

// ---- harness ---------------------------------------------------------------

interface Harness {
  server: Server;
  ws: StreetWebSocketServer;
  port: number;
  /** Number of times the attach handler (i.e. a real `connection`) fired. */
  connectionCount: () => number;
  close: () => Promise<void>;
}

/**
 * Stand up a real HTTP server with a StreetWebSocketServer attached and listen
 * on an ephemeral port. The attach handler increments a counter so tests can
 * assert whether a `connection` event was produced.
 */
async function makeHarness(options: WsServerOptions): Promise<Harness> {
  const server = createServer();
  const ws = new StreetWebSocketServer(options);
  let connections = 0;

  ws.attach(server, (socket) => {
    connections += 1;
    // Close immediately so the client side and server side both tear down.
    socket.close(1000, 'test-done');
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;

  return {
    server,
    ws,
    port,
    connectionCount: () => connections,
    close: async () => {
      await ws.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

type UpgradeOutcome =
  | { outcome: 'response'; status: number }
  | { outcome: 'upgrade'; status: number }
  | { outcome: 'error'; error: Error };

/**
 * Issue a raw WebSocket upgrade request and report precisely how the server
 * answered:
 *  - `response`  => the server replied with an ordinary HTTP status (e.g. 403,
 *                   401) and did NOT switch protocols.
 *  - `upgrade`   => the server completed the handshake (101 Switching Protocols).
 *  - `error`     => the request socket errored before any reply.
 *
 * Using `http.request` lets us read the exact status line: the client emits
 * `'response'` for a non-101 reply and `'upgrade'` for a completed handshake.
 */
function attemptUpgrade(port: number, headers: Record<string, string>): Promise<UpgradeOutcome> {
  return new Promise<UpgradeOutcome>((resolve) => {
    const key = randomBytes(16).toString('base64');
    const req = httpRequest({
      hostname: '127.0.0.1',
      port,
      path: '/',
      headers: {
        Connection: 'Upgrade',
        Upgrade: 'websocket',
        'Sec-WebSocket-Key': key,
        'Sec-WebSocket-Version': '13',
        ...headers,
      },
    });

    let settled = false;
    const settle = (value: UpgradeOutcome): void => {
      if (settled) return;
      settled = true;
      resolve(value);
    };

    req.on('upgrade', (res, socket) => {
      socket.destroy();
      settle({ outcome: 'upgrade', status: res.statusCode ?? 0 });
    });
    req.on('response', (res) => {
      res.resume(); // drain
      settle({ outcome: 'response', status: res.statusCode ?? 0 });
    });
    req.on('error', (error) => settle({ outcome: 'error', error }));
    req.end();
  });
}

/** Give the server a beat to (not) emit a `connection` event after a reply. */
function tick(ms = 50): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---- tests -----------------------------------------------------------------

describe('WebSocket upgrade integration (F-R2 / F-R1)', () => {
  it('rejects a disallowed Origin with 403 and never emits a connection event (Req 3.5)', async () => {
    const h = await makeHarness({ allowedOrigins: ['http://allowed.test'] });
    try {
      const result = await attemptUpgrade(h.port, { Origin: 'http://evil.test' });

      assert.equal(result.outcome, 'response', 'origin rejection must not switch protocols');
      assert.equal(
        (result as { status: number }).status,
        403,
        'disallowed Origin must yield 403 Forbidden',
      );

      await tick();
      assert.equal(h.connectionCount(), 0, 'no `connection` event for an origin-rejected upgrade');
    } finally {
      await h.close();
    }
  });

  it('rejects an allowed Origin with a failing authFn via the unchanged 401 path (Req 3.6)', async () => {
    const h = await makeHarness({
      allowedOrigins: ['http://allowed.test'],
      authFn: () => false, // passes the origin gate, fails auth
    });
    try {
      const result = await attemptUpgrade(h.port, { Origin: 'http://allowed.test' });

      assert.equal(result.outcome, 'response', 'auth rejection must not switch protocols');
      assert.equal(
        (result as { status: number }).status,
        401,
        'failing authFn must yield the existing 401 Unauthorized response',
      );

      await tick();
      assert.equal(h.connectionCount(), 0, 'a 401-rejected upgrade produces no connection');
    } finally {
      await h.close();
    }
  });

  it('completes the handshake for an allowed Origin with a passing authFn (connection fires)', async () => {
    const h = await makeHarness({
      allowedOrigins: ['http://allowed.test'],
      authFn: () => true,
    });
    try {
      const result = await attemptUpgrade(h.port, { Origin: 'http://allowed.test' });

      assert.equal(result.outcome, 'upgrade', 'allowed origin + passing auth must switch protocols');
      assert.equal((result as { status: number }).status, 101, '101 Switching Protocols expected');

      await tick();
      assert.equal(h.connectionCount(), 1, 'a successful upgrade emits exactly one connection');
    } finally {
      await h.close();
    }
  });
});
