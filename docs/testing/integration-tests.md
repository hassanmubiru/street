---
layout:    default
title:     "Integration Tests & Debugging"
parent:    "Testing"
nav_order: 1
permalink: /testing/integration-tests/
---

# Integration Testing

street's test suite uses only `node:test` and `node:assert`. No Jest, Mocha, or third-party test runner. Tests run against a live PostgreSQL instance — there are no database mocks.

---

## Why live database tests?

Mocking a database gives you false confidence. It tests your code, not your SQL. The most common production bugs involve:

- Queries that reference columns that don't exist
- Unique constraint violations
- Transaction semantics that don't match expectations
- NULL handling differences between mock and real DB

street's tests catch all of these because they run real SQL against a real PostgreSQL server.

---

## Running the tests

```bash
# Start PostgreSQL (if not already running)
docker run -d \
  --name pg-test \
  -e POSTGRES_DB=street_test \
  -e POSTGRES_USER=street \
  -e POSTGRES_PASSWORD=street_secret \
  -p 5432:5432 \
  postgres:16-alpine

# Compile
npx tsc

# Run tests
PG_HOST=localhost \
PG_PORT=5432 \
PG_DATABASE=street_test \
PG_USER=street \
PG_PASSWORD=street_secret \
JWT_SECRET="test-jwt-secret-at-least-32-chars!!" \
SESSION_KEY=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))") \
  node --test dist/tests/integration.test.js
```

Expected output:

```
▶ IoC Container
  ✔ resolves a class with no dependencies (1.2ms)
  ✔ resolves nested dependencies (0.8ms)
  ✔ returns singleton on repeated resolve (0.3ms)
  ✔ detects circular dependencies (0.5ms)
  ✔ register() overrides resolved singleton (0.2ms)
▶ IoC Container (5.4ms)

▶ JwtService
  ✔ signs and verifies a token (3.1ms)
  ✔ rejects tampered token (0.9ms)
  ✔ rejects expired token (1.1ms)
  ✔ decodes without verification (0.4ms)
  ✔ throws on short secret (0.2ms)
▶ JwtService (5.9ms)

▶ PostgreSQL Wire Protocol
  ✔ connects to PostgreSQL (48.3ms)
  ✔ executes a simple query (3.4ms)
  ✔ returns multiple rows (5.1ms)
  ✔ handles SQL errors gracefully (8.2ms)
  ✔ executes streaming query row by row (12.4ms)
▶ PostgreSQL Wire Protocol (78.1ms)

...

ℹ tests 52
ℹ pass 52
ℹ fail 0
ℹ duration_ms 1842
```

---

## Test structure

Each test file uses `describe` blocks (test suites) and `it` blocks (individual tests):

```typescript
import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

describe('UserRepository', () => {
  let pool: PgPool;
  let repo: UserRepository;

  before(async () => {
    // One-time setup per suite
    pool = new PgPool({ /* ... */ });
    await pool.initialize();
    repo = new UserRepository(pool);
  });

  after(async () => {
    // One-time teardown — ALWAYS clean up
    await pool.query('DELETE FROM users WHERE email LIKE \'%@test.local\'');
    await pool.close();
  });

  beforeEach(() => {
    // Per-test setup
    container.reset();
  });

  it('creates a user', async () => {
    const user = await repo.create({ /* ... */ });
    assert.ok(user.id);
    assert.equal(user.email, 'test@test.local');
  });
});
```

---

## Key testing patterns

### Asserting JSON responses

```typescript
const res = await fetch(port, '/api/users', {
  method: 'GET',
  headers: { Authorization: `Bearer ${token}` },
});

assert.equal(res.status, 200);
const body = JSON.parse(res.body) as { items: UserPublic[]; total: number };
assert.ok(Array.isArray(body.items));
assert.ok(body.total >= 0);
```

### Asserting error responses

```typescript
const res = await fetch(port, '/api/users/not-a-valid-uuid');
assert.equal(res.status, 400);

const error = JSON.parse(res.body) as { error: string; status: number };
assert.equal(error.error, 'BadRequestException');
assert.equal(error.status, 400);
```

### Testing database constraints

```typescript
it('enforces unique email constraint', async () => {
  const email = `unique-${Date.now()}@test.local`;

  await pool.query(`INSERT INTO users (id, email, name, password_hash)
                    VALUES (gen_random_uuid(), '${email}', 'A', 'h')`);

  await assert.rejects(
    () => pool.query(`INSERT INTO users (id, email, name, password_hash)
                      VALUES (gen_random_uuid(), '${email}', 'B', 'h')`),
    /unique/i
  );
});
```

### Testing streaming

```typescript
it('streams rows without buffering', async () => {
  const conn = await PgConnection.connect(PG_OPTS);
  const stream = conn.queryStream('SELECT generate_series(1, 100) AS n');

  const rows: string[] = [];
  let maxConcurrent = 0;

  await new Promise<void>((resolve, reject) => {
    stream.on('data', (row: Record<string, string | null>) => {
      rows.push(row['n'] ?? '');
      // Verify rows arrive one at a time, not all at once
      maxConcurrent = Math.max(maxConcurrent, 1);
    });
    stream.on('end', resolve);
    stream.on('error', reject);
  });

  assert.equal(rows.length, 100);
  assert.equal(rows[0], '1');
  assert.equal(rows[99], '100');

  await conn.close();
});
```

---

## Resource cleanup

Every test suite that creates resources must release them. Forgetting this causes port conflicts and connection leaks that make subsequent test runs fail.

### HTTP server cleanup

```typescript
let server: ReturnType<typeof streetApp>;

before(async () => {
  server = streetApp({ port: 3100 });
  await server.listen(3100);
});

after(async () => {
  await server.close();     // Stop accepting connections
});
```

### Database cleanup

```typescript
after(async () => {
  // Delete test data
  await pool.query(`DELETE FROM test_items WHERE name LIKE 'Test%'`);

  // Drop test-only tables
  await pool.query(`DROP TABLE IF EXISTS my_test_table`);

  // Remove migration tracking entries
  await pool.query(`DELETE FROM street_migrations WHERE name LIKE '%test%'`);

  // Close pool
  await pool.close();
});
```

### Connection cleanup

```typescript
let conn: PgConnection;

before(async () => {
  conn = await PgConnection.connect(PG_OPTS);
});

after(async () => {
  await conn.close();       // Always close explicitly
});
```

---

## Test isolation

Use `beforeEach(() => container.reset())` to prevent container state from leaking between tests:

```typescript
describe('UserService with mocks', () => {
  beforeEach(() => {
    container.reset();                        // Clear all singletons

    // Re-register mocks fresh for each test
    container.register(PgPool, mockPool);
    container.register(AppConfig, { jwtSecret: 'test-secret-32-chars-here!!!' } as AppConfig);
  });

  it('test 1 uses mock pool', () => { /* ... */ });
  it('test 2 uses fresh mock pool', () => { /* ... */ });
});
```

---

## CI test database

The GitHub Actions workflow runs a PostgreSQL 16 service container:

```yaml
services:
  postgres:
    image: postgres:16-alpine
    env:
      POSTGRES_DB: street_test
      POSTGRES_USER: street
      POSTGRES_PASSWORD: street_secret
    ports:
      - 5432:5432
    options: >-
      --health-cmd pg_isready
      --health-interval 10s
      --health-timeout 5s
      --health-retries 5
```

The `options.health-cmd` ensures the job waits until PostgreSQL is ready before running tests.

---

# Debugging

## Debug logging

Add temporary debug logs without framework changes:

```typescript
// In any handler or service
console.log('[debug] Request body:', JSON.stringify(ctx.body, null, 2));
console.log('[debug] Query result:', result.rows);
console.log('[debug] Heap:', process.memoryUsage());
```

## Node.js inspector

Attach the debugger to a running process:

```bash
# Start with inspector
node --inspect dist/src/main.js

# Or break on start
node --inspect-brk dist/src/main.js

# Then open: chrome://inspect in Chrome
# Or use VS Code: "Node: Attach" launch config
```

VS Code `launch.json`:

```json
{
  "version": "0.2.0",
  "configurations": [
    {
      "type": "node",
      "request": "attach",
      "name": "Attach to street",
      "port": 9229,
      "skipFiles": ["<node_internals>/**"]
    },
    {
      "type": "node",
      "request": "launch",
      "name": "Launch street tests",
      "program": "${workspaceFolder}/dist/tests/integration.test.js",
      "args": ["--test"],
      "envFile": "${workspaceFolder}/.env"
    }
  ]
}
```

## Diagnosing memory leaks

```bash
# Enable heap snapshots via SIGUSR2
node --heapsnapshot-signal=SIGUSR2 dist/src/main.js &

# After running workload:
kill -SIGUSR2 <pid>
# Creates: Heap.20240115.123456.12345.0.001.heapsnapshot

# Analyze in Chrome DevTools → Memory → Load snapshot
```

## Diagnosing socket leaks

```bash
# Monitor open file descriptors (sockets, connections)
lsof -p <pid> | wc -l

# Detail all network connections for the process
lsof -p <pid> -i | grep -E 'TCP|UDP'

# In the application: log active pool connections
setInterval(() => {
  console.log(`Pool: ${pool.size} total, ${pool.idle} idle`);
}, 10_000);
```

## Common issues and fixes

### `Error: connect ECONNREFUSED 127.0.0.1:5432`

PostgreSQL is not running or not listening on the expected port.

```bash
pg_isready -h localhost -p 5432
# localhost:5432 - no response
```

Fix: Start PostgreSQL or check `PG_HOST`/`PG_PORT`.

### `Error: Connection acquire timeout`

All pool connections are in use. The request waited `acquireTimeoutMs` and gave up.

Fix options:
1. Increase `maxConnections` (up to PostgreSQL's `max_connections`)
2. Optimize slow queries causing connections to be held longer
3. Add connection pool metrics to telemetry and monitor

### `UnauthorizedException: Invalid or expired token`

The JWT is expired (check `exp` claim) or signed with a different secret.

```bash
# Decode a token to inspect (no verification)
node -e "
const [,payload] = 'YOUR_TOKEN'.split('.');
console.log(JSON.parse(Buffer.from(payload, 'base64url').toString()));
"
```

### `TypeError: Cannot read properties of undefined (reading 'resolve')`

`reflect-metadata` was not imported before the decorated class was loaded.

Fix: Ensure `import 'reflect-metadata'` is the **first** line of `src/main.ts`, before any other import.

### `RangeError: Maximum call stack size exceeded`

Circular dependency in the IoC container. Check for circular imports between services. The container should throw a descriptive `CircularDependencyError` instead — if you see a stack overflow, a class may not have been decorated with `@Injectable`.

### Tests pass locally but fail in CI

Most common causes:
1. **Clock skew in JWT tests** — use `expiresInSeconds: 86400` in tests, not `-1`
2. **Race conditions** — ensure `before()` awaits full initialization
3. **Missing env vars** — check CI env configuration in the workflow file
4. **Port conflicts** — randomize test server ports with `Math.floor(Math.random() * 900) + 3100`
