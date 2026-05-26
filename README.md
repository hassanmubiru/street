# Street Framework

**Production-grade, memory-safe TypeScript backend framework built on Node.js core modules.**

Street is built entirely from Node.js core — `node:http`, `node:net`, `node:crypto`, `node:stream`, `node:cluster` — plus two carefully chosen dependencies. **No Express. No pg. No Zod. No Prisma.** Every component enforces strict memory bounds and full type safety.

```bash
npm install @streetjs/core
```

```typescript
import 'reflect-metadata';
import { streetApp, Injectable, Controller, Get } from '@streetjs/core';
import type { StreetContext } from '@streetjs/core';

@Injectable()
@Controller('/api')
class HelloController {
  @Get('/hello')
  async hello(ctx: StreetContext) {
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

[![CI](https://github.com/hassanmubiru/street/actions/workflows/ci-cd.yml/badge.svg)](https://github.com/hassanmubiru/street/actions/workflows/ci-cd.yml)
[![Memory Leak Tests](https://github.com/hassanmubiru/street/actions/workflows/memory-leak.yml/badge.svg)](https://github.com/hassanmubiru/street/actions/workflows/memory-leak.yml)
[![Security Lint](https://github.com/hassanmubiru/street/actions/workflows/security-lint.yml/badge.svg)](https://github.com/hassanmubiru/street/actions/workflows/security-lint.yml)
[![Publish](https://github.com/hassanmubiru/street/actions/workflows/publish.yml/badge.svg)](https://github.com/hassanmubiru/street/actions/workflows/publish.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![npm version](https://img.shields.io/npm/v/@streetjs/core)](https://www.npmjs.com/package/@streetjs/core)
[![Node.js](https://img.shields.io/badge/node-%3E%3D20-brightgreen)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/typescript-%3E%3D5.0-blue)](https://www.typescriptlang.org)
[![package size](https://img.shields.io/bundlephobia/min/@streetjs/core)](https://bundlephobia.com/package/@streetjs/core)

## Documentation

[📖 Full documentation site](https://hassanmubiru.github.io/street) — hosted Jekyll site with guides, examples, and API reference.

| Category | Key Pages |
|---|---|
| **Getting started** | [Installation & setup](docs/getting-started/installation.md) · [Your first server](docs/getting-started/first-server.md) · [Configuration](docs/getting-started/configuration.md) · [Project structure](docs/getting-started/project-structure.md) |
| **Core** | [Dependency injection](docs/core/dependency-injection.md) · [Routing](docs/core/routing.md) · [Controllers](docs/core/controllers.md) · [Middleware](docs/core/middleware.md) |
| **Database** | [PostgreSQL wire driver](docs/database/postgres-wire-driver.md) · [Repositories](docs/database/repositories.md) |
| **Security** | [JWT](docs/security/jwt.md) · [Sessions, vault, rate limiter, XSS](docs/security/) |
| **Realtime** | [WebSocket](docs/realtime/websocket.md) · SSE streaming |
| **Performance** | [Telemetry](docs/performance/telemetry.md) · LRU cache · Cluster coordinator |
| **Storage** | [Multipart uploads](docs/storage/multipart-uploads.md) |
| **CLI** | [Commands](docs/cli/commands.md) |
| **Testing** | [Integration tests](docs/testing/integration-tests.md) |
| **Deployment** | [Docker](docs/deployment/docker.md) · [Hosting guide](docs/deployment/hosting-guide.md) |
| **Examples** | [User API](docs/examples/user-api.md) · [Streaming query](docs/examples/streaming-query.md) |

## Testing

To run tests locally:

```bash
./scripts/test-setup.sh
```

Or manually:

```bash
docker-compose up -d postgres
# wait until healthy
PG_HOST=127.0.0.1 PG_PORT=55432 PG_USER=street PG_PASSWORD=street_secret PG_DATABASE=street_test npm run test:run
```
