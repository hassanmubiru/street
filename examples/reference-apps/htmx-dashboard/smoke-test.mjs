// End-to-end smoke test for the HTMX Dashboard reference app.
//   node examples/reference-apps/htmx-dashboard/smoke-test.mjs
// Boots the real server, drives real HTTP/SSE requests, asserts the flows, exits 0.

import assert from 'node:assert/strict';
import http from 'node:http';
import { createDashboard } from './server.mjs';

const app = createDashboard({ intervalMs: 50 });
const port = await app.listen(0);
const base = `http://127.0.0.1:${port}`;

function get(path, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = http.get(base + path, { headers }, (res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => resolve({ status: res.statusCode, type: res.headers['content-type'], body }));
    });
    req.on('error', reject);
  });
}

// SSE: collect the first data frame, then close.
function sseFirstFrame(path, timeoutMs = 2000) {
  return new Promise((resolve, reject) => {
    const req = http.get(base + path, { headers: { accept: 'text/event-stream' } }, (res) => {
      let buf = '';
      const timer = setTimeout(() => { req.destroy(); reject(new Error('SSE timeout')); }, timeoutMs);
      res.on('data', (c) => {
        buf += c.toString('utf8');
        if (buf.includes('data:')) { clearTimeout(timer); req.destroy(); resolve(buf); }
      });
    });
    req.on('error', () => { /* destroyed after resolve */ });
  });
}

let failures = 0;
function check(name, fn) { try { fn(); console.log('  ok  ' + name); } catch (e) { failures++; console.log('  FAIL ' + name + ': ' + e.message); } }

// 1) Health.
const live = await get('/health/live');
check('health/live returns 200', () => assert.equal(live.status, 200));

// 2) Full page load is wrapped in the layout (has <html> + the tiles target).
const page = await get('/');
check('full page is HTML', () => assert.match(page.type, /text\/html/));
check('full page includes the layout (<!doctype html>)', () => assert.match(page.body, /<!doctype html>/i));
check('full page includes the tiles container', () => assert.match(page.body, /id="tiles"/));
check('full page renders metric labels', () => assert.match(page.body, /Active users/));

// 3) HTMX request to / returns just the page fragment (no layout).
const frag = await get('/', { 'hx-request': 'true' });
check('HTMX page load omits the layout', () => assert.doesNotMatch(frag.body, /<!doctype html>/i));
check('HTMX page load still has the tiles', () => assert.match(frag.body, /id="tiles"/));

// 4) /tiles returns a bare HTML fragment (no <html>, has tile values).
const tiles = await get('/tiles');
check('/tiles is a fragment (no doctype)', () => assert.doesNotMatch(tiles.body, /<!doctype html>/i));
check('/tiles contains tile markup', () => assert.match(tiles.body, /class="tile"/));

// 5) SSE stream pushes a tiles event.
const frame = await sseFirstFrame('/events');
check('SSE stream emits a tiles event', () => assert.match(frame, /event: tiles/));
check('SSE frame carries tile HTML', () => assert.match(frame, /class="tile"/));

// 6) 404 for unknown route.
const nf = await get('/nope');
check('unknown route returns 404', () => assert.equal(nf.status, 404));

await app.close();
console.log(failures === 0 ? '\n✅ htmx-dashboard reference app: all checks passed' : `\n❌ ${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
