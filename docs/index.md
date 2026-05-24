---
layout:    home
title:     Home
nav_order: 1
permalink: /
---

# street

**Production-grade, memory-safe TypeScript backend framework built on Node.js core modules.**

{: .fs-6 .fw-300 }

[Get started now](#quick-start){: .btn .btn-primary .fs-5 .mb-4 .mb-md-0 .mr-2 }
[View on GitHub](https://github.com/your-org/street){: .btn .fs-5 .mb-4 .mb-md-0 }

---

## What makes street different?

street is built entirely from Node.js core modules — `node:http`, `node:net`, `node:crypto`, `node:stream`, `node:cluster` — plus two carefully chosen dependencies. **No Express. No pg. No Zod. No Prisma.**

Every component enforces strict memory bounds:

| Component | Memory bound | Mechanism |
|---|---|---|
| HTTP bodies | 1 MB default | Stream abort on overflow |
| File uploads | Disk only | Streamed chunk-by-chunk |
| DB results | 256 rows buffered | Socket-level backpressure |
| LRU cache | `maxEntries` cap | LRU eviction |
| Rate limiter | 100K IPs, 1K timestamps/IP | Periodic stale sweep |
| Telemetry history | 1,440 samples | Ring buffer |
| WebSocket connections | `maxConnections` | Reject with 1013 |

---

## Quick start
{: #quick-start }

```bash
npm install @streetjs/core reflect-metadata ws
```

```typescript
import 'reflect-metadata';
import { streetApp, Injectable, Controller, Get } from '@streetjs/core';
import type { StreetContext } from '@streetjs/core';

@Injectable()
@Controller('/api')
class HelloController {
  @Get('/hello')
  async hello(ctx: StreetContext): Promise<void> {
    ctx.json({ message: 'Hello from street!' });
  }
}

const app = streetApp({ port: 3000 });
app.registerController(HelloController);
await app.listen();
// [street] Listening on http://0.0.0.0:3000
```

```bash
curl http://localhost:3000/api/hello
# {"message":"Hello from street!"}
```

---

## Install

```bash
npm install @streetjs/core
```

Requires **Node.js ≥ 20** and **TypeScript ≥ 5.0** with:

```json
{
  "compilerOptions": {
    "module":                 "NodeNext",
    "moduleResolution":       "NodeNext",
    "experimentalDecorators": true,
    "emitDecoratorMetadata":  true,
    "strict":                 true
  }
}
```

---

## Feature overview

- **IoC container** — constructor injection, singleton registry, circular dep detection
- **HTTP router** — compiled regex routes, param extraction, typed middleware pipeline
- **PostgreSQL driver** — pure wire protocol v3 (no `pg`), streaming row-by-row with backpressure
- **JWT** — HMAC-SHA256 via `node:crypto`, timing-safe verify
- **Sessions** — AES-256-GCM, tamper-detection, random IV per encryption
- **Vault Mode** — scrypt + AES-256-GCM for KEK-based secret decryption
- **Multipart uploads** — streams to disk, ≤128 KB heap regardless of file size
- **WebSocket** — heartbeat, bounded connections, typed event emitter
- **SSE** — heartbeat keep-alive, backpressure-aware
- **LRU cache** — TTL expiry, O(1) eviction
- **Rate limiting** — sliding window, BigInt nanosecond precision
- **XSS sanitizer** — recursive deep sanitization
- **Clustering** — `node:cluster` with IPC heartbeat and auto-restart
- **CLI kernel** — `@Command` decorator with DI integration
- **OpenAPI** — auto-generated 3.1 spec from route decorators
