// Soak test: drive a live StreetJS server with steady traffic for a configured
// duration, sampling RSS, heap, event-loop delay, active handles, sockets, and
// timers. Fails if memory or handles grow monotonically (leak) or event-loop
// delay exceeds a threshold. Emits JSON + CSV artifacts. Zero third-party deps.
//
//   SOAK_MINUTES=30 node --expose-gc scripts/audit/soak.mjs
//
import { streetApp } from 'streetjs';
import { monitorEventLoopDelay } from 'node:perf_hooks';
import { writeFileSync, mkdirSync } from 'node:fs';

const MINUTES = Number(process.env.SOAK_MINUTES ?? 0.5);     // default 30s smoke
const DURATION_MS = Math.round(MINUTES * 60_000);
const SAMPLE_MS = Number(process.env.SOAK_SAMPLE_MS ?? 2_000);
const PORT = 34010, BASE = `http://127.0.0.1:${PORT}`;
const EL_DELAY_MAX_MS = Number(process.env.SOAK_EL_DELAY_MAX_MS ?? 100);

const app = streetApp({ port: PORT });
app.use(async (ctx, next) => {
  if (ctx.path === '/ping') { ctx.json({ ok: true, n: Math.random() }); return; }
  await next();
});
await app.listen(PORT, '127.0.0.1');

const h = monitorEventLoopDelay({ resolution: 10 });
h.enable();

let running = true, reqs = 0, errs = 0;
async function driver() {
  while (running) {
    try { const r = await fetch(`${BASE}/ping`); await r.arrayBuffer(); reqs++; }
    catch { errs++; }
  }
}
const drivers = Array.from({ length: 20 }, driver);

const mb = (b) => +(b / 1048576).toFixed(2);
const samples = [];
function sample() {
  const m = process.memoryUsage();
  const handles = process._getActiveHandles();
  samples.push({
    t: Date.now(),
    rss: mb(m.rss), heap: mb(m.heapUsed),
    handles: handles.length,
    sockets: handles.filter((x) => x?.constructor?.name === 'Socket').length,
    timers: handles.filter((x) => /Timeout|Timer/.test(x?.constructor?.name ?? '')).length,
    elDelayP99: +(h.percentile(99) / 1e6).toFixed(2),
    reqs,
  });
}

const t0 = Date.now();
sample();
const iv = setInterval(sample, SAMPLE_MS);
await new Promise((r) => setTimeout(r, DURATION_MS));
running = false;
clearInterval(iv);
await Promise.allSettled(drivers);
global.gc?.();
await new Promise((r) => setTimeout(r, 500));
sample();
await app.close();
h.disable();

// ── Leak / stability analysis ─────────────────────────────────────────────────
// Compare the median of the first quarter vs the last quarter of samples; a
// healthy process is flat or sawtooth (GC), not monotonically rising.
const q = Math.max(1, Math.floor(samples.length / 4));
const median = (arr, k) => {
  const v = arr.map((s) => s[k]).sort((a, b) => a - b);
  return v[Math.floor(v.length / 2)];
};
const firstQ = samples.slice(0, q), lastQ = samples.slice(-q);
const rssGrowth = median(lastQ, 'rss') - median(firstQ, 'rss');
const heapGrowth = median(lastQ, 'heap') - median(firstQ, 'heap');
const handleGrowth = median(lastQ, 'handles') - median(firstQ, 'handles');
const elP99Max = Math.max(...samples.map((s) => s.elDelayP99));

mkdirSync('artifacts', { recursive: true });
writeFileSync('artifacts/soak.json', JSON.stringify({
  minutes: MINUTES, durationMs: DURATION_MS, reqs, errs,
  rssGrowthMb: rssGrowth, heapGrowthMb: heapGrowth, handleGrowth, elP99MaxMs: elP99Max, samples,
}, null, 2));
writeFileSync('artifacts/soak.csv',
  'tMs,rssMb,heapMb,handles,sockets,timers,elP99Ms,reqs\n' +
  samples.map((s) => [s.t - t0, s.rss, s.heap, s.handles, s.sockets, s.timers, s.elDelayP99, s.reqs].join(',')).join('\n'));

// Thresholds (tunable via env): a true leak shows sustained RSS+heap growth and
// rising handle counts. Allow modest one-time growth.
const RSS_MAX = Number(process.env.SOAK_RSS_GROWTH_MAX_MB ?? 40);
const HEAP_MAX = Number(process.env.SOAK_HEAP_GROWTH_MAX_MB ?? 25);
const fail = [];
if (errs > 0) fail.push(`requests errored: ${errs}`);
if (rssGrowth > RSS_MAX && heapGrowth > HEAP_MAX) fail.push(`memory grew: rss+${rssGrowth}MB heap+${heapGrowth}MB`);
if (handleGrowth > 5) fail.push(`handles grew: +${handleGrowth}`);
if (elP99Max > EL_DELAY_MAX_MS) fail.push(`event-loop p99 ${elP99Max}ms > ${EL_DELAY_MAX_MS}ms`);

console.log(`soak ${MINUTES}min: reqs=${reqs} errs=${errs} rssΔ=${rssGrowth}MB heapΔ=${heapGrowth}MB handlesΔ=${handleGrowth} elP99max=${elP99Max}ms`);
console.log(fail.length === 0 ? 'RESULT: STABLE ✅' : `RESULT: UNSTABLE ❌ — ${fail.join('; ')}`);
process.exit(fail.length === 0 ? 0 : 1);
