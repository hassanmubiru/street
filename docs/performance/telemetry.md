---
layout:    default
title:     "Telemetry, Caching & Clustering"
parent:    "Performance"
nav_order: 1
permalink: /performance/telemetry/
---

# Performance

## Telemetry

street's `TelemetryTracker` collects heap usage, request latency, and error rates. All history is stored in a bounded ring buffer — it never grows unboundedly.

---

### Setup

```typescript
import { TelemetryTracker, telemetryMiddleware } from './telemetry/tracker.js';

const telemetry = new TelemetryTracker(60_000);   // Collect a sample every 60 seconds
container.register(TelemetryTracker, telemetry);

app.use(telemetryMiddleware(telemetry));           // Record every request
```

---

### What is tracked

| Metric | Description |
|---|---|
| `heapUsedMb` | V8 heap used (MB) |
| `rss` | Resident set size (MB) — total process memory |
| `latencyP50` | Median request latency (ms) |
| `latencyP99` | 99th percentile latency (ms) |
| `requestCount` | Total requests since start |
| `errorCount` | Total error responses since start |

---

### Accessing metrics

```typescript
// Snapshot: current values
const snap = telemetry.snapshot();
console.log(`Heap: ${snap.heapUsedMb.toFixed(1)} MB`);
console.log(`P99 latency: ${snap.latencyP99.toFixed(1)} ms`);

// History: last N samples
const history = telemetry.getHistory(60);    // Last 60 minutes (at 1/min)

// Health summary
const health = telemetry.health();
// {
//   status: 'ok',
//   uptime: 3600,
//   pid: 12345,
//   heap: { usedMb: '45.2', rssMb: '120.5' },
//   requests: { total: 15000, errors: 12 },
//   latency: { p50Ms: '2.3', p99Ms: '45.0' },
//   timestamp: '2024-01-15T10:23:45.123Z'
// }
```

---

### The `/api/health` endpoint

The built-in `HealthController` exposes:

```bash
# Real-time health + DB check
curl http://localhost:3000/api/health

# Telemetry history (last 60 samples)
curl http://localhost:3000/api/metrics?count=60
```

Health response format:

```json
{
  "status": "ok",
  "uptime": 3600.5,
  "pid": 12345,
  "heap": { "usedMb": "45.2", "rssMb": "120.5" },
  "requests": { "total": 15000, "errors": 12 },
  "latency": { "p50Ms": "2.3", "p99Ms": "45.0" },
  "timestamp": "2024-01-15T10:23:45.123Z",
  "checks": {
    "database": { "status": "ok", "latencyMs": 2 }
  },
  "pool": { "size": 5, "idle": 3 }
}
```

Status is `"degraded"` if any check fails or heap exceeds 900 MB.

---

### Ring buffer sizing

Samples are collected every `collectIntervalMs` (default 60,000 ms). The history holds at most `MAX_SAMPLES` (1,440) entries — exactly 24 hours at 1 sample/minute. When the buffer is full, the oldest sample is dropped:

```typescript
if (this.samples.length >= MAX_SAMPLES) {
  this.samples.shift();   // O(n) — acceptable at 1/min frequency
}
```

For higher-frequency sampling (e.g., every 10 seconds), reduce `MAX_SAMPLES` or increase `collectIntervalMs` to stay within a sensible memory budget.

---

### Cleanup

```typescript
telemetry.destroy();   // Clears the collection timer
```

---

## Caching

The `LruCache` provides a bounded, TTL-aware in-memory cache using a doubly-linked list for O(1) eviction.

---

### Setup

```typescript
import { LruCache } from './cache/lru.js';

// Cache up to 1000 entries, each valid for 5 minutes
const cache = new LruCache<string, UserPublic>({
  maxEntries: 1000,
  ttlMs: 300_000,
});
```

---

### Usage

```typescript
// Set
cache.set(userId, userObject);

// Get (returns undefined if missing or expired)
const user = cache.get(userId);
if (!user) {
  // Cache miss — fetch from DB
  const fetched = await this.repo.findById(userId);
  if (fetched) cache.set(userId, toPublicUser(fetched));
}

// Check existence
cache.has(userId);

// Invalidate
cache.delete(userId);

// Clear everything
cache.clear();

// Size
console.log(cache.size);
```

---

### Cache-aside pattern

```typescript
@Injectable()
export class UserService {
  private readonly cache = new LruCache<string, UserPublic>({
    maxEntries: 5000,
    ttlMs: 60_000,           // 1 minute TTL
  });

  async findById(id: string): Promise<UserPublic | null> {
    const cached = this.cache.get(id);
    if (cached) return cached;

    const user = await this.repo.findById(id);
    if (user) {
      const pub = toPublicUser(user);
      this.cache.set(id, pub);
      return pub;
    }
    return null;
  }

  async update(id: string, dto: UpdateUserDto): Promise<UserPublic> {
    const updated = await this.repo.update(id, dto);
    // Invalidate cache on write
    this.cache.delete(id);
    return toPublicUser(updated!);
  }
}
```

---

### LRU eviction behavior

When `cache.set()` is called and `size > maxEntries`, the **least recently used** entry is evicted. "Recently used" is updated on every `get()` call.

Example with `maxEntries: 3`:

```
set('a', 1) → [a]
set('b', 2) → [a, b]
set('c', 3) → [a, b, c]
get('a')    → [b, c, a]   ← a moved to head (MRU)
set('d', 4) → [c, a, d]   ← b evicted (LRU)
```

---

### TTL sweep

A periodic sweep runs every `ttlMs / 2` milliseconds and removes expired entries. This prevents stale entries from occupying slots until they happen to be accessed.

```typescript
cache.destroy();   // Stops the sweep timer, clears all entries
```

---

## Clustering

street can run in cluster mode, spawning one worker per CPU core. The `ClusterCoordinator` manages the workers from the primary process.

---

### How it works

```
Primary process (ClusterCoordinator)
  ├── Worker 1 (HTTP server on port 3000)
  ├── Worker 2 (HTTP server on port 3000)  ← OS load balances
  ├── Worker 3 (HTTP server on port 3000)
  └── Worker 4 (HTTP server on port 3000)
```

The OS distributes incoming connections across workers using `SO_REUSEPORT`. Each worker is an independent Node.js process — a crash in one worker does not affect others.

---

### Enabling cluster mode

Set `NODE_ENV=production`. The main entry point detects this and starts the cluster coordinator:

```typescript
// src/main.ts
if (cluster.isPrimary && process.env['NODE_ENV'] === 'production') {
  const coordinator = new ClusterCoordinator({
    workers: parseInt(process.env['WORKERS'] ?? '0', 10) || undefined,
    heartbeatIntervalMs: 10_000,
    heartbeatTimeoutMs: 30_000,
  });
  coordinator.start();
  return;
}

// Workers fall through to bootstrap()
bootstrap();
```

---

### Worker count

By default, one worker per CPU core (from `os.cpus().length`). Override:

```bash
WORKERS=4 NODE_ENV=production node dist/src/main.js
```

For I/O-bound APIs (database queries, network calls), 2× CPU count can improve throughput. For CPU-bound work, match CPU count exactly.

---

### IPC heartbeat

Each worker sends a `heartbeat` IPC message to the primary every 5 seconds:

```typescript
// Worker side
const heartbeatTimer = workerHeartbeat(5_000);
```

The primary tracks `lastHeartbeat` per worker. If a worker goes silent for `heartbeatTimeoutMs` (30 seconds), it is killed and a new worker is spawned:

```typescript
// Primary side — automatic
if (now - state.lastHeartbeat > this.opts.heartbeatTimeoutMs) {
  state.worker.kill('SIGTERM');
  // cluster 'exit' event fires → _spawnWorker() called automatically
}
```

---

### Auto-restart

When a worker exits (crash, OOM, SIGKILL), the `cluster 'exit'` event fires and the coordinator spawns a replacement after a 500 ms delay:

```typescript
cluster.on('exit', (worker, code, signal) => {
  setTimeout(() => this._spawnWorker(), 500).unref();
});
```

The delay prevents tight restart loops if the worker crashes immediately on startup (e.g., due to a bug).

---

### State considerations in cluster mode

Each worker has its own in-memory state. The `LruCache`, rate limiter, and telemetry tracker are **per-worker**:

- Rate limiting: each worker enforces its own limit. With N workers, the effective limit is `N × maxRequests`. For accurate global rate limiting, use a shared store (Redis).
- Cache: each worker has its own cache. Cache invalidation must go through the database (cache-aside pattern with short TTLs).
- Telemetry: each worker reports independently. The `/api/health` endpoint reflects the responding worker's metrics.

---

## Memory Safety

Memory safety is the foundation of street's design. Every component enforces an upper bound on its memory usage.

---

### Why it matters

Node.js is a single-threaded event loop. A memory leak in one part of the application degrades the entire server. Unlike a Java application with multiple threads (where a leak in one thread does not immediately affect others), a Node.js leak hits the event loop latency for all requests.

street's philosophy: **if it can grow, it must be bounded.**

---

### Bounded components

| Component | Bound | Mechanism |
|---|---|---|
| HTTP body | 1 MB default | `maxBodyBytes` option, stream abort |
| File uploads | N/A (disk) | Streaming to disk, never to heap |
| PostgreSQL results | 256 rows buffered | `StreetPostgresWireStream.MAX_BUFFERED` |
| Connection pool | `maxConnections` | Acquire queue with timeout |
| Acquire wait queue | 100 callers | Throws when full |
| Rate limiter keys | 100,000 IPs | Oldest evicted when full |
| Rate limiter timestamps per IP | 1,000 | Oldest evicted |
| LRU cache entries | `maxEntries` | LRU eviction |
| Telemetry history | 1,440 samples | Ring buffer |
| WebSocket connections | `maxConnections` | Closed with 1013 when full |
| Webhook queue | 10,000 items | Oldest dropped |
| XSS recursion depth | 32 levels | Hard limit, returns null |

---

### Backpressure

Backpressure is how a slow consumer slows down a fast producer. street applies it at two levels:

**HTTP → Application:**
The body parser reads in chunks. If the total exceeds `maxBodyBytes`, the socket is destroyed and a 413 error is returned. This prevents large request bodies from exhausting heap.

**Database → Application:**
`StreetPostgresWireStream` pauses the TCP socket when its internal queue reaches capacity. The PostgreSQL server stops sending rows. No row is held in memory longer than needed.

**Application → HTTP:**
Streaming response handlers check `res.write()` return value. On `false`, they pause the database stream. On `drain`, they resume. This prevents a slow HTTP client from causing rows to queue in memory.

---

### Resource cleanup checklist

Every long-lived resource must be closed during graceful shutdown:

```typescript
process.once('SIGTERM', async () => {
  clearInterval(myInterval);      // Timers
  clearTimeout(myTimeout);        // Timeouts
  rateLimiter.destroy();          // Clears sweep interval + data
  cache.destroy();                // Clears sweep interval + data
  telemetry.destroy();            // Clears collection interval
  await wsServer.close();         // Terminates WS connections
  await app.close();              // Stops accepting new HTTP connections
  await pool.close();             // Closes all PG connections
  process.exit(0);
});
```

---

### Detecting memory leaks

```bash
# Watch heap usage over time
node --inspect dist/src/main.js
# Then open chrome://inspect in Chrome → Memory tab

# Heap snapshot comparison
node -e "
  const v8 = require('v8');
  v8.writeHeapSnapshot('./heap-before.heapsnapshot');
  // ... run workload ...
  v8.writeHeapSnapshot('./heap-after.heapsnapshot');
"
```

Signs of a leak:
- `heapUsedMb` growing monotonically in telemetry history
- `rss` growing unboundedly after each request batch
- P99 latency increasing as heap pressure triggers GC pauses

Common causes in street applications:
- Intervals not unref'd or cleared
- Event listeners not removed on socket close
- Unbounded arrays appended to (use ring buffers)
- Closures capturing large objects (use `WeakRef` or explicit nulling)
