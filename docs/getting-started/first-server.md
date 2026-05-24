---
layout:    default
title:     "First Server"
parent:    "Getting Started"
nav_order: 3
permalink: /getting-started/first-server/
---

# Your First Server

This walkthrough builds a complete working API from scratch, explaining every decision along the way. By the end you will have a server with dependency injection, routing, validation, error handling, and a database connection.

---

## Step 1: Entry point

Every street application starts with `src/main.ts`. The entry point is responsible for three things: loading config, wiring dependencies, and starting the server.

```typescript
// src/main.ts
import 'reflect-metadata';                    // Must be first — loads the metadata polyfill

import { container } from './core/container.js';
import { AppConfig } from './config/index.js';
import { PgPool } from './database/pool.js';
import { streetApp } from './http/server.js';
import { HelloController } from './controllers/hello.controller.js';

async function bootstrap(): Promise<void> {
  // 1. Load and validate environment config
  const config = new AppConfig();
  config.load();                              // Reads from process.env
  container.register(AppConfig, config);      // Make it injectable

  // 2. Connect to the database
  const pool = new PgPool({
    host: config.pgHost,
    port: config.pgPortNumber,
    user: config.pgUser,
    password: config.pgPassword,
    database: config.pgDatabase,
    minConnections: 2,
    maxConnections: 10,
  });
  await pool.initialize();                    // Warm up min connections
  container.register(PgPool, pool);

  // 3. Create and configure the HTTP app
  const app = streetApp({
    port: config.httpPort,
    host: config.host,
    uploadsDir: './uploads',
  });

  // 4. Register controllers
  app.registerController(HelloController);

  // 5. Start listening
  await app.listen();

  // 6. Graceful shutdown
  process.once('SIGTERM', async () => {
    await app.close();
    await pool.close();
    process.exit(0);
  });
}

bootstrap().catch((err) => {
  console.error('[street] Fatal error:', err);
  process.exit(1);
});
```

> **Why `import 'reflect-metadata'` first?**
> The metadata polyfill patches the global `Reflect` object before any decorator runs. If it loads after a decorated class is imported, `Reflect.getMetadata` will return `undefined` for that class and dependency injection will silently fail.

---

## Step 2: A simple controller

Controllers group related route handlers. The `@Controller` decorator registers a URL prefix and optional middleware. Each method decorator (`@Get`, `@Post`, etc.) registers a route.

```typescript
// src/controllers/hello.controller.ts
import { Injectable } from '../core/container.js';
import { Controller, Get, Post } from '../core/decorators.js';
import type { StreetContext } from '../core/context.js';

@Injectable()
@Controller('/api')
export class HelloController {

  @Get('/hello')
  async hello(ctx: StreetContext): Promise<void> {
    ctx.json({ message: 'Hello, world!' });
  }

  @Get('/hello/:name')
  async helloName(ctx: StreetContext): Promise<void> {
    const name = ctx.params['name'] ?? 'stranger';
    ctx.json({ message: `Hello, ${name}!` });
  }

  @Post('/echo')
  async echo(ctx: StreetContext): Promise<void> {
    ctx.json({ received: ctx.body }, 201);
  }
}
```

Test it:

```bash
curl http://localhost:3000/api/hello
# {"message":"Hello, world!"}

curl http://localhost:3000/api/hello/Alice
# {"message":"Hello, Alice!"}

curl -X POST http://localhost:3000/api/echo \
  -H 'Content-Type: application/json' \
  -d '{"key":"value"}'
# {"received":{"key":"value"}}
```

---

## Step 3: Injecting a service

Services contain business logic. They are marked `@Injectable()` and injected via constructor parameters.

```typescript
// src/services/greeter.service.ts
import { Injectable } from '../core/container.js';

@Injectable()
export class GreeterService {
  greet(name: string): string {
    return `Hello, ${name}! The time is ${new Date().toISOString()}.`;
  }
}
```

```typescript
// src/controllers/hello.controller.ts
import { Injectable } from '../core/container.js';
import { Controller, Get } from '../core/decorators.js';
import type { StreetContext } from '../core/context.js';
import { GreeterService } from '../services/greeter.service.js';

@Injectable()
@Controller('/api')
export class HelloController {
  // TypeScript emits constructor parameter types as metadata.
  // The IoC container reads that metadata to resolve GreeterService automatically.
  constructor(private readonly greeter: GreeterService) {}

  @Get('/hello/:name')
  async helloName(ctx: StreetContext): Promise<void> {
    const name = ctx.params['name'] ?? 'stranger';
    ctx.json({ message: this.greeter.greet(name) });
  }
}
```

Register in `main.ts` — no change needed. The container resolves `GreeterService` automatically when it resolves `HelloController`:

```typescript
app.registerController(HelloController);
// Internally: container.resolve(HelloController)
//   → sees constructor needs GreeterService
//   → container.resolve(GreeterService)
//   → new GreeterService() (no deps)
//   → new HelloController(greetService)
```

---

## Step 4: Reading the request

`StreetContext` exposes everything about the request and provides typed methods to write the response.

```typescript
@Get('/search')
async search(ctx: StreetContext): Promise<void> {
  // Query string: /search?q=street&page=2
  const query = ctx.query['q'] ?? '';
  const page = parseInt(ctx.query['page'] ?? '1', 10);

  // Route params: /users/:id
  const id = ctx.params['id'];

  // Headers (lowercased keys)
  const auth = ctx.headers['authorization'];

  // Parsed body (for POST/PUT with Content-Type: application/json)
  const body = ctx.body as { name?: string };

  // Request timing (BigInt nanoseconds since epoch)
  const elapsed = process.hrtime.bigint() - ctx.startTime;

  ctx.json({ query, page, elapsed: elapsed.toString() });
}
```

### Writing responses

```typescript
// JSON (most common)
ctx.json({ data: result });
ctx.json({ error: 'not found' }, 404);

// Plain text
ctx.text('pong', 200);

// HTML
ctx.html('<h1>Hello</h1>');

// Empty response (204 No Content)
ctx.send(204);

// Custom headers
ctx.setHeader('X-Request-Id', requestId);

// Cookies
ctx.setCookie('session', encryptedBlob, {
  httpOnly: true,
  secure: true,
  sameSite: 'Lax',
  maxAge: 86400,
});
```

---

## Step 5: Validation

Add schema validation to any route using `@Validate`. It runs before the handler and throws `BadRequestException` automatically if validation fails.

```typescript
import { Controller, Post, Validate } from '../core/decorators.js';
import type { ValidationSchema } from '../core/types.js';

const createItemSchema: ValidationSchema = {
  body: {
    name: { type: 'string', required: true, min: 1, max: 100 },
    price: { type: 'number', required: true },
    email: { type: 'email', required: false },
  },
};

@Injectable()
@Controller('/api/items')
export class ItemController {

  @Post('/')
  @Validate(createItemSchema)
  async create(ctx: StreetContext): Promise<void> {
    // Reaches here only if validation passed
    const body = ctx.body as { name: string; price: string };
    ctx.json({ created: body }, 201);
  }
}
```

Invalid request:

```bash
curl -X POST http://localhost:3000/api/items \
  -H 'Content-Type: application/json' \
  -d '{"price": "not-a-number"}'

# HTTP 400:
# {
#   "error": "BadRequestException",
#   "message": "Validation failed",
#   "status": 400,
#   "details": ["body.name is required", "body.price must be a number"]
# }
```

---

## Step 6: Error handling

Throw any `StreetException` subclass from a handler or middleware. The global error handler catches it and formats the response automatically.

```typescript
import { NotFoundException, BadRequestException } from '../http/exceptions.js';

@Get('/:id')
async getOne(ctx: StreetContext): Promise<void> {
  const id = ctx.params['id'];
  if (!id) throw new BadRequestException('Missing id parameter');

  const item = await this.service.findById(id);
  if (!item) throw new NotFoundException(`Item ${id} not found`);

  ctx.json(item);
}
```

Available exceptions:

| Class | Status | Default message |
|---|---|---|
| `BadRequestException` | 400 | Bad Request |
| `UnauthorizedException` | 401 | Unauthorized |
| `ForbiddenException` | 403 | Forbidden |
| `NotFoundException` | 404 | Not Found |
| `ConflictException` | 409 | Conflict |
| `UnprocessableException` | 422 | Unprocessable Entity |
| `InternalException` | 500 | Internal Server Error |
| `ServiceUnavailableException` | 503 | Service Unavailable |

Unhandled errors (non-`StreetException`) are caught by the global handler, logged to stderr, and returned as HTTP 500.

---

## Step 7: Compile and run

```bash
npx tsc
node dist/src/main.js
```

Full sequence output:

```
[street] Listening on http://0.0.0.0:3000
```

Test your endpoints:

```bash
# Health check
curl http://localhost:3000/api/health | jq

# Hello world
curl http://localhost:3000/api/hello/Bob
# {"message":"Hello, Bob! The time is 2024-01-15T10:23:45.123Z."}

# Validation error
curl -X POST http://localhost:3000/api/echo \
  -H 'Content-Type: application/json' \
  -d '{"test":true}'
# {"received":{"test":true}}

# 404
curl http://localhost:3000/does/not/exist
# {"error":"NotFoundException","message":"Route GET /does/not/exist not found","status":404}
```

---

## Complete first server (all together)

```
my-api/
├── package.json
├── tsconfig.json
├── src/
│   ├── main.ts
│   ├── reflect-shim.d.ts
│   ├── config/index.ts
│   ├── core/
│   │   ├── container.ts
│   │   ├── context.ts
│   │   ├── decorators.ts
│   │   └── types.ts
│   ├── http/
│   │   ├── server.ts
│   │   └── exceptions.ts
│   ├── router/router.ts
│   ├── controllers/hello.controller.ts
│   └── services/greeter.service.ts
└── migrations/
```

Compile and start:

```bash
npx tsc && node dist/src/main.js
```

You now have a type-safe, injection-driven, validated HTTP API server — built entirely on Node.js core modules.
