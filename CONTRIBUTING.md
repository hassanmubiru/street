# Contributing to street

Thank you for your interest in contributing. This document explains how to set up the development environment, run tests, and submit pull requests.

---

## Development setup

```bash
git clone https://github.com/your-org/street.git
cd street
npm install
```

Start a local PostgreSQL instance:

```bash
docker run -d \
  --name street-dev-db \
  -e POSTGRES_DB=street_dev \
  -e POSTGRES_USER=street \
  -e POSTGRES_PASSWORD=street \
  -p 5432:5432 \
  postgres:16-alpine
```

Copy and configure environment:

```bash
cp .env.example .env
# Fill in values — PG_HOST=localhost is already correct for the Docker setup above
```

Build and verify:

```bash
npm run build
npm test
```

---

## Code standards

- **TypeScript strict mode** — all `strict`, `noImplicitAny`, `noUnusedLocals` flags must pass
- **No new runtime dependencies** — street's dependency count (2) is intentional
- **Memory bounds required** — every new collection, queue, or cache must have an explicit upper bound
- **No `any` casts** — use typed generics or unknown with type guards
- **`.js` extensions on imports** — NodeNext ESM requires explicit extensions in source

Run the type-checker before committing:

```bash
npx tsc --noEmit
```

---

## Testing

All new features must include integration tests in `tests/integration.test.ts` using only `node:test` and `node:assert`.

Tests must:
- Connect to a real PostgreSQL instance
- Clean up all created data in `after()` hooks
- Close all connections and servers explicitly
- Not use `setTimeout` for timing-dependent assertions (use proper async/await)

Run tests:

```bash
PG_HOST=localhost PG_USER=street PG_PASSWORD=street PG_DATABASE=street_dev \
  JWT_SECRET="test-secret-at-least-32-chars-here!!" \
  SESSION_KEY=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))") \
  node --test dist/tests/integration.test.js
```

---

## Test suite reference

street has three layers of testing. All run with `node:test` and `node:assert/strict` — no test framework dependencies.

### Integration tests

**File:** `tests/integration.test.ts` \
**Requires:** PostgreSQL (see [Development setup](#development-setup)) \
**Coverage:** IoC container, HTTP server, router, PostgreSQL wire protocol, PgPool, repository, migrations, schema \
**Run:**

```bash
PG_HOST=localhost PG_USER=street PG_PASSWORD=street PG_DATABASE=street_dev \
  JWT_SECRET="test-secret-at-least-32-chars-here!!" \
  SESSION_KEY=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))") \
  node --test dist/tests/integration.test.js
```

### Wire protocol & memory stress tests

These test the PostgreSQL wire protocol and connection stress-handling using **mocked sockets** — no database required.

| File | What it tests | Command |
|---|---|---|
| `tests/wire-protocol.test.ts` | Wire protocol parsing, param encoding, extended query flow | `node --test dist/tests/wire-protocol.test.js` |
| `tests/wire-stream.test.ts` | Socket streaming, chunked reads, `queryStream()` lifecycle | `node --test dist/tests/wire-stream.test.js` |
| `tests/memory-leak.test.ts` | Pool acquire/release cycles, connection leak detection | `node --test dist/tests/memory-leak.test.js` |
| `tests/stress.test.ts` | Concurrent pool operations, graceful shutdown, O(n) bounds | `node --test dist/tests/stress.test.js` |

### System tests (six suites)

Six standalone test suites covering security, performance, and fault tolerance. Can be run individually or via the unified runner.

**Unified runner** (recommended for CI):

```bash
# All suites
node dist/tests/system/runner.js

# CI mode with JSON output, skip PostgreSQL-dependent suites
node dist/tests/system/runner.js --ci --json --skip-pg

# Single suite by name
node dist/tests/system/runner.js security
node dist/tests/system/runner.js fuzz-testing
```

| Suite | File | Covers | Needs PG? |
|---|---|---|---|
| `security` | `tests/system/security.test.ts` | JWT sign/verify/expiry, session encrypt/decrypt/CSRF, vault encrypt/decrypt, XSS sanitize (HTML/JS/unicode/null-bytes), rate-limiter (rolling-window/concurrent), auth middleware (roles/permissions), CORS, constant-time comparison | no |
| `memory-safety` | `tests/system/memory-safety.test.ts` | LRU bounds, eviction order, clear/delete, concurrent access, heap caps, pool max-connections, fixed-size buffers, stream high-water-mark, max listeners | no |
| `load-testing` | `tests/system/load-testing.test.ts` | Concurrent HTTP (500×1.5k requests), router throughput (1k dispatches), pool concurrent queries (20 clients), sustained SSE heartbeat load, batch memory | no |
| `fuzz-testing` | `tests/system/fuzz-testing.test.ts` | SSE random payloads/empty/close/unicode/binary, WebSocket random/huge/malformed/multiframe, multipart boundary fuzzing, field overflow, chunk boundary | no |
| `chaos-testing` | `tests/system/chaos-testing.test.ts` | Fault injection (connect/dns/timeout), shutdown (graceful/forced), resource exhaustion (FDs/memory), worker crash, heart-attack recovery | no |
| `infrastructure` | `tests/system/infrastructure.test.ts` | Container resolution (nested/circular/override), CLI commands (migrate/user), WebhookDispatch, TelemetryTracker, OpenAPI generation, cluster coordinator lifecycle | **yes** |

### Running everything in one go

```bash
npm run build  # compile once

# Integration (requires PG)
npm test

# System (unified runner)
npm run test:system

# System suites individually
npm run test:security
npm run test:fuzz
npm run test:chaos
npm run test:memory
npm run test:load
npm run test:infra   # requires PG

# Wire protocol & stress (no PG needed)
node --test dist/tests/wire-protocol.test.js \
          dist/tests/wire-stream.test.js \
          dist/tests/memory-leak.test.js \
          dist/tests/stress.test.js
```

---

## Pull request checklist

- [ ] `npx tsc --noEmit` passes with zero errors
- [ ] All existing tests pass
- [ ] New tests added for new functionality
- [ ] `CHANGELOG.md` updated under `[Unreleased]`
- [ ] No new runtime dependencies introduced
- [ ] Memory bounds documented for any new data structures
- [ ] Public API additions exported from `src/index.ts`

---

## Commit message format

```
type(scope): short description

Longer explanation if needed.

Fixes #123
```

Types: `feat`, `fix`, `docs`, `refactor`, `test`, `chore`, `perf`

Examples:
```
feat(database): add SCRAM-SHA-256 authentication support
fix(pool): prevent acquire queue memory leak on pool close
docs(websocket): add heartbeat configuration example
perf(lru): switch eviction to O(1) doubly-linked list
```

---

## Releasing (maintainers only)

Patch release:

```bash
npm run version:patch          # bumps 1.0.0 → 1.0.1
git add package.json CHANGELOG.md
git commit -m "chore: release v1.0.1"
git tag v1.0.1
git push origin main --tags    # triggers npm-publish workflow
```
