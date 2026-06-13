// Live dashboard example — server pushes metric updates to all subscribers.
//
//   npm run build:app -w packages/core
//   node examples/05-live-dashboard/main.mjs
//
// A "metrics" channel; several dashboard clients subscribe and receive periodic
// metric snapshots broadcast by the server. Asserts every subscriber received
// every tick, then exits 0 (doubles as a smoke test).

import { createServer } from 'node:http';
import { WebSocket } from 'ws';
import { StreetWebSocketServer, ChannelHub } from 'streetjs';

const CHANNEL = 'metrics';
const hub = new ChannelHub();

const http = createServer();
const wss = new StreetWebSocketServer();
wss.attach(http, (socket, req) => {
  const viewer = req.headers['x-user'] ?? `viewer-${socket.id.slice(0, 4)}`;
  hub.bind(socket);
  hub.join(CHANNEL, viewer, socket);
});

await new Promise((r) => http.listen(0, r));
const port = http.address().port;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function dashboard(name) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}`, { headers: { 'x-user': name } });
  const metrics = [];
  ws.on('message', (raw) => {
    const m = JSON.parse(raw.toString('utf8'));
    if (m.type === 'metric') metrics.push(m.payload);
  });
  return { ws, metrics, ready: new Promise((res) => ws.on('open', res)) };
}

// Two dashboards subscribe.
const a = dashboard('dash-a');
const b = dashboard('dash-b');
await Promise.all([a.ready, b.ready]);
await sleep(30);
console.log('subscribers present:', hub.presence(CHANNEL));

// Server pushes 3 metric ticks.
const ticks = [
  { cpu: 12, rps: 340 },
  { cpu: 47, rps: 410 },
  { cpu: 31, rps: 290 },
];
for (const t of ticks) {
  hub.publish(CHANNEL, 'metric', t);
  await sleep(15);
}
await sleep(30);

console.log('dash-a received:', a.metrics);
console.log('dash-b received:', b.metrics);

import assert from 'node:assert/strict';
assert.equal(a.metrics.length, 3, 'dash-a should receive all 3 ticks');
assert.equal(b.metrics.length, 3, 'dash-b should receive all 3 ticks');
assert.deepEqual(a.metrics, ticks);

a.ws.close();
b.ws.close();
await wss.close();
await new Promise((r) => http.close(r));
console.log('\n✅ live-dashboard example completed successfully');
