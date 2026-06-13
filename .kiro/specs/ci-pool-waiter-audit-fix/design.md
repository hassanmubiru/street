# Design: CI Failure Fix — PgPool Waiter Enqueue & esbuild Audit

## Overview

The CI pipeline is failing across seven reported checks:

| Failing check | Node | Underlying cause |
| --- | --- | --- |
| Core | 20, 22 | Root cause A (full coverage suite runs the affected pool tests) |
| Memory Leak | 20, 22 | Root cause A |
| memory-safety | 20, 22 | Root cause A |
| Policy Checks (no-placeholders + audit) | — | Root cause B |

The failures collapse into **two independent root causes**. Both have been
reproduced locally on this checkout.

This design captures the diagnosis and the minimal, surgical fix for each. No
behavioral redesign is required — the existing contracts are already documented
in code; the implementation simply violates one of them, and a dependency needs
a security bump.

## Root Cause A — PgPool waiter enqueue is not synchronous

### Location
`packages/core/src/database/pool.ts` — `PgPool.acquire()`.

### Current behavior
```ts
async acquire(): Promise<PgConnection> {
  // ...
  await this.ensureInitialized();          // (1) microtask boundary
  const start = Date.now();
  const conn = await this._doAcquire();    // (2) waiter is enqueued INSIDE here
  this._recordAcquire(Date.now() - start);
  return conn;
}
```

`ensureInitialized()` is an `async` function. Even when the pool is already
initialized (`if (this.initialized) return;`), `await this.ensureInitialized()`
still yields a microtask. Because the caller is only pushed onto `waitQueue`
inside `_doAcquire()` — which runs *after* that yield — the enqueue is **not**
synchronous with the `acquire()` call.

The code comment directly above this block already states the required
contract:

> "we must not introduce an extra `await` boundary here: that microtask yield
> would let a concurrent `close()` run before `_doAcquire` enqueues this caller
> as a waiter… `_doAcquire` enqueues the waiter synchronously… so calling it in
> the same tick keeps `close()`'s waiter-rejection contract correct."

The implementation contradicts its own comment: the unconditional
`await this.ensureInitialized()` *is* the forbidden boundary.

### Observed failures (all the same bug)
- `tests/memory-leak.test.ts` → "rejects pending acquire waiters when pool is
  closed": the waiter isn't in the queue when `close()` runs, so the deferred
  `_doAcquire()` hits the synchronous `if (this.closed) throw new Error('Pool is
  closed')` guard and rejects with `Pool is closed` instead of the expected
  `Connection pool is closed`.
- `tests/system/memory-safety.test.ts`:
  - "throws synchronously when wait queue exceeds MAX_WAIT" — asserts
    `waitQueue.length === 100` immediately after 100 synchronous `acquire()`
    calls; it is `0` because no enqueue has happened yet.
  - "close rejects queued waiters (cleans up acquire timeout timers)" — same
    `Pool is closed` vs `Connection pool is closed` mismatch.
  - "release of unready connection does not consume waiter from queue" —
    asserts `waitQueue.length === 1` synchronously; it is `0`.

### Fix approach
Preserve lazy initialization while restoring synchronous enqueue for the common
(already-initialized) path. When `this.initialized` is already true, do **not**
introduce an `await` before `_doAcquire()`; call `_doAcquire()` in the same
tick. Only await initialization on the cold path (first acquire).

Two acceptable shapes:

1. Branch on `this.initialized`:
   ```ts
   async acquire(): Promise<PgConnection> {
     if (!this.initialized) {
       await this.ensureInitialized();
     }
     const start = Date.now();
     const conn = await this._doAcquire();
     this._recordAcquire(Date.now() - start);
     return conn;
   }
   ```
   On the warm path there is no `await` before `_doAcquire()`, so the waiter is
   pushed onto `waitQueue` synchronously within the `acquire()` call's tick —
   honoring the documented contract and the synchronous-throw guarantee
   (`wait queue full`).

2. (Rejected) Move the `this.closed` / enqueue logic out of `_doAcquire` into a
   synchronous prelude. Larger change, more surface area, not needed.

Approach (1) is chosen: smallest possible change, directly aligned with the
existing comment, and it keeps the cold-path lazy init intact.

### Edge cases preserved
- First-ever `acquire()` (cold path) still awaits `ensureInitialized()`.
- `acquire()` after `close()`: `_doAcquire` still throws `Pool is closed`
  synchronously (the "acquire after close throws synchronously" test depends on
  this and must keep passing).
- `_recordAcquire` timing unaffected.

## Root Cause B — High-severity esbuild advisory fails `npm audit`

### Location
`packages/core/package.json` — `devDependencies.esbuild: "^0.28.0"`.

### Current behavior
`Policy Checks` runs `npm audit --audit-level=high`, which exits non-zero. The
placeholder scan (TODO/FIXME/HACK/@ts-ignore) is clean; the audit is the sole
cause. The resolved tree contains `esbuild@0.28.0`, flagged by:
- GHSA-gv7w-rqvm-qjhr (missing binary integrity verification → RCE via
  `NPM_CONFIG_REGISTRY`)

The advisory range is `0.17.0 – 0.28.0`, so the `^0.28.0` range cannot resolve
to a patched build.

### Usage scope
`esbuild` is a **dev-only** dependency, imported only by
`packages/core/src/tests/browser-build.test.ts` to bundle the browser entry and
assert it is free of Node core modules. It is not shipped in any published
tarball. The bump is low risk to runtime behavior; the only verification needed
is that the browser-build test still passes.

### Fix approach
Bump `esbuild` to the patched major/minor (the first release outside the
advisory range, i.e. `esbuild >= 0.29.0` / current patched latest) by updating
the `devDependencies` range in `packages/core/package.json` and refreshing the
lockfile. Implementation should:
1. Update the version range to a patched line.
2. Run `npm install` to update `package-lock.json`.
3. Confirm `npm audit --audit-level=high` exits 0.
4. Re-run `browser-build.test.ts` to confirm the bundler API still behaves
   (esbuild's `build()` API is stable across these minor versions).

If the bumped esbuild changes any API surface the test relies on, adjust the
test call site accordingly (not anticipated).

## Verification Strategy

After both fixes, reproduce each failing CI job locally:

1. `npm run build:app -w packages/core` (compile, shared by 3 jobs).
2. Root cause A:
   - `node --test packages/core/dist/tests/memory-leak.test.js packages/core/dist/tests/wire-protocol.test.js`
   - `node --test packages/core/dist/tests/system/memory-safety.test.js`
   - `npm run coverage -w packages/core` (the Core job's full suite).
3. Root cause B:
   - `npm audit --audit-level=high` → exit 0.
   - Re-run the browser-build test specifically.

All previously failing assertions must pass and no previously passing test may
regress (notably "acquire after close throws synchronously" and the SCRAM/wire
suites).

## Out of Scope
- MySQL/SQLite pool implementations (their messages differ by design and their
  tests pass).
- Any change to the `pool:exhausted` event contract, timeout behavior, or
  public API surface.
- The other CI workflows not listed as failing.
