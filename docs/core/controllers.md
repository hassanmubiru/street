---
layout:    default
title:     "Controllers"
parent:    "Core"
nav_order: 3
permalink: /core/controllers/
description: "Controllers in StreetJS — define HTTP endpoints with decorators, route params and the typed request context in your TypeScript backend."
---

# Controllers

Controllers are classes that group HTTP route handlers. They receive a request context, call services, and write a response. Controllers are thin by design — business logic belongs in services.

---

## Anatomy of a controller

```typescript
import { Injectable } from '../core/container.js';
import { Controller, Get, Post, Put, Delete, Validate, ApiOperation } from '../core/decorators.js';
import type { StreetContext } from '../core/context.js';
import { NotFoundException, BadRequestException } from '../http/exceptions.js';
import { ProductService } from '../services/product.service.js';
import type { ValidationSchema } from '../core/types.js';

const createSchema: ValidationSchema = {
  body: {
    name: { type: 'string', required: true, min: 1, max: 100 },
    price: { type: 'number', required: true },
  },
};

@Injectable()                        // Marks class for IoC resolution
@Controller('/api/products')         // URL prefix for all routes in this class
export class ProductController {

  constructor(
    private readonly products: ProductService,  // Injected automatically
  ) {}

  @Get('/')
  @ApiOperation({ summary: 'List products', tags: ['products'] })
  async list(ctx: StreetContext): Promise<void> {
    const page = parseInt(ctx.query['page'] ?? '1', 10);
    const limit = parseInt(ctx.query['limit'] ?? '20', 10);
    const result = await this.products.findAll(page, limit);
    ctx.json(result);
  }

  @Get('/:id')
  async getOne(ctx: StreetContext): Promise<void> {
    const id = ctx.params['id'];
    if (!id) throw new BadRequestException('Missing id');
    const product = await this.products.findById(id);
    if (!product) throw new NotFoundException(`Product ${id} not found`);
    ctx.json(product);
  }

  @Post('/')
  @Validate(createSchema)
  async create(ctx: StreetContext): Promise<void> {
    const body = ctx.body as { name: string; price: string };
    const product = await this.products.create(body);
    ctx.json(product, 201);
  }

  @Delete('/:id')
  async remove(ctx: StreetContext): Promise<void> {
    const id = ctx.params['id'];
    if (!id) throw new BadRequestException('Missing id');
    await this.products.remove(id);
    ctx.send(204);
  }
}
```

---

## The StreetContext object

Every handler receives a `StreetContext` as its only argument. It is the single interface between the HTTP layer and your code.

### Reading the request

```typescript
ctx.method          // 'GET' | 'POST' | 'PUT' | 'DELETE' | ...
ctx.path            // '/api/products/abc-123'
ctx.params          // { id: 'abc-123' }
ctx.query           // { page: '2', limit: '10' }
ctx.headers         // { 'content-type': 'application/json', 'authorization': 'Bearer ...' }
ctx.body            // Parsed JSON object, plain text, or null
ctx.files           // ParsedFile[] from multipart uploads
ctx.user            // AuthenticatedUser | null (set by auth middleware)
ctx.state           // Record<string, unknown> — arbitrary per-request state
ctx.startTime       // BigInt nanosecond timestamp — for latency calculation
ctx.req             // Raw IncomingMessage (escape hatch)
ctx.res             // Raw ServerResponse (escape hatch)
```

### Writing the response

```typescript
// JSON (sets Content-Type: application/json)
ctx.json({ message: 'ok' });
ctx.json({ error: 'not found' }, 404);

// Text (sets Content-Type: text/plain)
ctx.text('pong');

// HTML (sets Content-Type: text/html)
ctx.html('<h1>Hello</h1>');

// Empty body with status code
ctx.send(204);   // No Content
ctx.send(202);   // Accepted

// Custom response header
ctx.setHeader('X-Request-Id', '...');
ctx.setHeader('Location', '/api/products/new-id');

// Cookies
ctx.cookie('session')   // Read a cookie value → string | undefined
ctx.setCookie('session', blob, {
  httpOnly: true,
  secure: true,
  sameSite: 'Lax',
  maxAge: 86400,
  path: '/',
});

// Check if response has been sent (avoid double-write)
if (!ctx.sent) {
  ctx.json({ fallback: true });
}
```

### The `ctx.sent` guard

`ctx.sent` becomes `true` after the first call to `ctx.json()`, `ctx.text()`, `ctx.html()`, or `ctx.send()`. Subsequent calls are silently ignored. This prevents double-response errors in complex middleware pipelines.

---

## Controller registration

Register controllers after all dependencies are in the container:

```typescript
// main.ts
container.register(AppConfig, config);
container.register(PgPool, pool);

// Order matters for route conflict resolution
app.registerController(HealthController);     // /api/health
app.registerController(UserController);       // /api/users
app.registerController(ProductController);    // /api/products
```

`registerController` throws if the class is not decorated with `@Controller`.

---

## Returning vs throwing

**Always throw, never return an error response directly.** The global error handler converts `StreetException` subclasses to typed JSON responses automatically.

```typescript
// ✓ Correct
throw new NotFoundException('Product not found');

// ✗ Avoid — bypasses global error handling, loses type information
ctx.json({ error: 'not found' }, 404);
```

The only exception is writing non-error responses with specific status codes:

```typescript
ctx.json(newProduct, 201);   // Created
ctx.send(204);               // No Content
```

---

## File upload handlers

Multipart uploads are automatically parsed before the handler runs. Access uploaded files via `ctx.files`:

```typescript
@Post('/avatar')
async uploadAvatar(ctx: StreetContext): Promise<void> {
  if (ctx.files.length === 0) {
    throw new BadRequestException('No file provided');
  }

  const file = ctx.files[0]!;

  // File is already on disk — just store the path
  await this.userService.setAvatar(ctx.user!.id, {
    originalName: file.originalName,
    mimeType: file.mimeType,
    size: file.size,
    path: file.path,  // absolute path in uploads directory
  });

  ctx.json({ uploaded: file.originalName }, 201);
}
```

See [Multipart Uploads](../storage/multipart-uploads.md) for full details.

---

## Streaming responses (SSE)

For Server-Sent Events, write directly to `ctx.res` using the SSE helper:

```typescript
import { createSse } from '../websocket/sse.js';

@Get('/:id/events')
async events(ctx: StreetContext): Promise<void> {
  const sse = createSse(ctx.res, 30_000);  // 30s heartbeat

  sse.send({ event: 'connected', data: { ts: Date.now() } });

  // Keep sending until client disconnects
  const interval = setInterval(() => {
    if (sse.closed) { clearInterval(interval); return; }
    sse.send({ event: 'update', data: { ts: Date.now() } });
  }, 5_000);
  interval.unref();

  ctx.res.once('close', () => clearInterval(interval));
}
```

See [Server-Sent Events](../realtime/sse.md) for full details.
