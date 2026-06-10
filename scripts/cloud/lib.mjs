// scripts/cloud/lib.mjs
//
// Shared health + smoke probing helpers for the Cloud Deployment Verifier
// (Requirements 2.9, 2.10, 2.13). These functions measure a deployed instance
// against the published bounds and return raw measurements; the status itself
// is assigned by `classifyTargetVerification`/`buildDeploymentReport` in
// @streetjs/core so the report — not these scripts — is the single authority on
// a target's status.
//
// Zero runtime dependencies: only Node core (`fetch`, `AbortSignal.timeout`).

import { readFileSync } from 'node:fs';

/** Per-request health budget — each endpoint must respond within 5s (Req 2.9). */
export const HEALTH_LATENCY_BUDGET_MS = 5_000;

/** Smoke completion budget — ≤300s with 0 failed/0 errored cases (Req 2.10). */
export const SMOKE_DURATION_BUDGET_MS = 300_000;

/** The two health endpoints every target must serve (Req 2.9). */
export const HEALTH_PATHS = ['/health/live', '/health/ready'];

/**
 * Probe a single endpoint once, enforcing the per-request latency budget.
 * Returns `{ ok, latencyMs }`. A non-200 response, a body that does not report a
 * healthy status, a timeout, or a transport error all yield `ok: false`.
 *
 * @param {string} baseUrl  Base URL of the deployed instance.
 * @param {string} path     Endpoint path (e.g. `/health/live`).
 * @param {number} budgetMs Per-request latency budget in milliseconds.
 */
export async function probeOnce(baseUrl, path, budgetMs = HEALTH_LATENCY_BUDGET_MS) {
  const started = Date.now();
  try {
    const res = await fetch(new URL(path, baseUrl), {
      signal: AbortSignal.timeout(budgetMs),
      headers: { accept: 'application/json' },
    });
    const latencyMs = Date.now() - started;
    if (!res.ok) return { ok: false, latencyMs, reason: `status ${res.status}` };
    if (latencyMs > budgetMs) return { ok: false, latencyMs, reason: `latency ${latencyMs}ms` };
    // Accept either a JSON `{ status: 'healthy'|'ok'|'up' }` body or any 200.
    const text = await res.text();
    const healthy = text === '' || /\b(healthy|ok|up|live|ready|pass)\b/i.test(text);
    return { ok: healthy, latencyMs, reason: healthy ? undefined : 'unhealthy body' };
  } catch (err) {
    return { ok: false, latencyMs: Date.now() - started, reason: String(err?.message ?? err) };
  }
}

/**
 * Probe `/health/live` and `/health/ready`, retrying until each succeeds or the
 * overall deadline passes. Returns the health shape consumed by
 * `TargetVerification`: `{ live, ready, maxLatencyMs }` plus a retained log.
 *
 * @param {string} baseUrl
 * @param {{ deadlineMs?: number, budgetMs?: number }} [opts]
 */
export async function probeHealth(baseUrl, opts = {}) {
  const budgetMs = opts.budgetMs ?? HEALTH_LATENCY_BUDGET_MS;
  const deadline = Date.now() + (opts.deadlineMs ?? 30_000);
  const log = [];
  const result = { live: false, ready: false, maxLatencyMs: 0 };

  for (const path of HEALTH_PATHS) {
    let last;
    do {
      last = await probeOnce(baseUrl, path, budgetMs);
      result.maxLatencyMs = Math.max(result.maxLatencyMs, last.latencyMs);
      if (last.ok) break;
      await new Promise((r) => setTimeout(r, 1_000));
    } while (Date.now() < deadline);

    if (path === '/health/live') result.live = last.ok;
    if (path === '/health/ready') result.ready = last.ok;
    log.push(`${path}: ${last.ok ? 'PASS' : 'FAIL'} (${last.latencyMs}ms${last.reason ? ', ' + last.reason : ''})`);
  }

  return { health: result, log: log.join('\n') };
}

/**
 * Load the smoke-check list. Each check is `{ path, method?, expectStatus? }`.
 * Falls back to the two health endpoints when no check file is supplied.
 *
 * @param {string} [checksPath]
 */
export function loadSmokeChecks(checksPath) {
  if (checksPath) {
    const parsed = JSON.parse(readFileSync(checksPath, 'utf8'));
    if (!Array.isArray(parsed)) throw new Error(`smoke checks file must be a JSON array: ${checksPath}`);
    return parsed;
  }
  return HEALTH_PATHS.map((path) => ({ path, method: 'GET', expectStatus: 200 }));
}

/**
 * Run the smoke checks against the deployed instance, bounded by the 300s
 * completion budget (Req 2.10). Returns a `SmokeResult`-shaped object:
 * `{ passed, failed, errored, durationMs, output }`. Each check that returns the
 * expected status passes; a wrong status fails; an exception (unreachable,
 * timeout) errors. The full per-check log is retained in `output` (Req 2.13).
 *
 * @param {string} baseUrl
 * @param {Array<{path:string,method?:string,expectStatus?:number}>} checks
 * @param {{ budgetMs?: number }} [opts]
 */
export async function runSmoke(baseUrl, checks, opts = {}) {
  const budgetMs = opts.budgetMs ?? SMOKE_DURATION_BUDGET_MS;
  const started = Date.now();
  const deadline = started + budgetMs;
  const log = [];
  let passed = 0;
  let failed = 0;
  let errored = 0;

  for (const check of checks) {
    const method = check.method ?? 'GET';
    const expect = check.expectStatus ?? 200;
    if (Date.now() >= deadline) {
      errored += 1;
      log.push(`ERROR ${method} ${check.path}: smoke budget exhausted before execution`);
      continue;
    }
    const remaining = Math.max(1_000, deadline - Date.now());
    try {
      const res = await fetch(new URL(check.path, baseUrl), {
        method,
        signal: AbortSignal.timeout(Math.min(remaining, 30_000)),
      });
      if (res.status === expect) {
        passed += 1;
        log.push(`PASS ${method} ${check.path} -> ${res.status}`);
      } else {
        failed += 1;
        log.push(`FAIL ${method} ${check.path} -> ${res.status} (expected ${expect})`);
      }
    } catch (err) {
      errored += 1;
      log.push(`ERROR ${method} ${check.path}: ${String(err?.message ?? err)}`);
    }
  }

  return {
    passed,
    failed,
    errored,
    durationMs: Date.now() - started,
    output: log.join('\n'),
  };
}

/** Parse `--flag value` style options from an argv slice into a plain object. */
export function parseFlags(argv) {
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) {
        flags[key] = true;
      } else {
        flags[key] = next;
        i++;
      }
    }
  }
  return flags;
}
