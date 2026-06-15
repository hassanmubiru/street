---
layout:    default
title:     "FAQ"
nav_order: 14
permalink: /faq/
description: "Frequently asked questions about StreetJS Framework."
---

{% include doc-styles.html %}

<div class="doc-header">
<span class="dh-label">Reference</span>
<h1>FAQ</h1>
<p>Common questions about installation, TypeScript configuration, PostgreSQL, WebSockets, and deployment.</p>
</div>

---

## General

### What is StreetJS Framework?

StreetJS is a production-grade TypeScript backend framework built entirely on Node.js core modules. It provides an HTTP server, router, dependency injection container, PostgreSQL driver, WebSocket server, security primitives, and a CLI — all without Express, pg, Prisma, or other heavy abstractions.

### Why build another Node.js framework?

Most Node.js frameworks layer abstractions on top of abstractions. StreetJS takes the opposite approach: implement each component directly on Node.js core, enforce strict memory bounds, and expose a clean TypeScript API. The result is a framework where you can read and understand every line of the runtime.

### Is StreetJS production-ready?

Yes. StreetJS is designed for production from the ground up — bounded memory, parameterized queries, SCRAM-SHA-256 PostgreSQL auth, AES-256-GCM sessions, and a comprehensive test suite including memory leak, wire protocol, load, fuzz, chaos, and security tests.

### What are the two dependencies?

- **`reflect-metadata`** — enables TypeScript's `emitDecoratorMetadata` for constructor injection
- **`ws`** — WebSocket framing protocol (Node.js `http.Server` handles upgrades but not framing)

Everything else — HTTP, TLS, streams, crypto, cluster — ships with Node.js.

---

## Installation

### What Node.js version is required?

Node.js **20 or higher**. StreetJS uses `node:test`, top-level `await`, `crypto.randomUUID()`, and other Node 20 APIs.

### What TypeScript version is required?

TypeScript **5.0 or higher** with `NodeNext` module resolution.

### Do I need to install `reflect-metadata` separately?

Yes. Add it to your project:

```bash
npm install reflect-metadata
```

And import it as the **first line** of your entry point:

```typescript
import 'reflect-metadata';  // must be first
import { streetApp } from 'streetjs';
```

### Can I use StreetJS without the CLI?

Yes. Install `streetjs` directly and set up your project manually. The CLI (`@streetjs/cli`) is optional tooling.

---

## TypeScript

### Why does StreetJS require `NodeNext` module resolution?

`NodeNext` is the correct module resolution mode for Node.js ESM. It requires explicit `.js` extensions on imports, which matches how Node.js resolves modules at runtime. Other modes (`bundler`, `node16`) have subtle differences that cause issues in production.

### Why do imports use `.js` extensions in `.ts` files?

This is required by `NodeNext` module resolution. TypeScript resolves `.ts` files when it encounters `.js` imports during compilation, but the compiled output uses `.js` — which is what Node.js needs at runtime.

```typescript
// Correct — TypeScript resolves this to user.service.ts during compilation
import { UserService } from './user.service.js';
```

### I'm getting `error TS1240: Unable to resolve signature of class decorator`

Add these to your `tsconfig.json`:

```json
{
  "compilerOptions": {
    "experimentalDecorators": true,
    "emitDecoratorMetadata": true
  }
}
```

---

## Database

### Does StreetJS support databases other than PostgreSQL?

The built-in driver is PostgreSQL-only (wire protocol v3). For other databases, use the database's official Node.js driver and register it manually with the container.

### Do I need to install `pg`?

No. StreetJS implements the PostgreSQL wire protocol directly over `node:net`. There is no `pg` dependency.

### How do I run migrations?

```bash
# Using the CLI
street migrate:create create_users_table
street migrate:run

# Or directly
node dist/main.js migrate
```

### Does StreetJS support connection pooling?

Yes. `PgPool` manages a bounded pool of connections with idle timeout, acquire timeout, and automatic dead connection replacement.

### Are queries safe from SQL injection?

Yes, when you use parameterized queries:

```typescript
// Safe — parameterized
await pool.query('SELECT * FROM users WHERE id = $1', [userId]);

// Unsafe — never do this
await pool.query(`SELECT * FROM users WHERE id = '${userId}'`);
```

---

## WebSockets

### How do I limit WebSocket connections?

Pass `maxConnections` to `StreetWebSocketServer`:

```typescript
const wss = new StreetWebSocketServer({ maxConnections: 10_000 });
```

Connections beyond the limit are rejected with close code 1013 (Try Again Later).

### How do I authenticate WebSocket connections?

Pass a JWT token as a query parameter and validate it in the connection handler:

```typescript
wss.on('connection', (socket, req) => {
  const url = new URL(req.url!, 'http://localhost');
  const token = url.searchParams.get('token');
  if (!token) { socket.close(4001, 'Unauthorized'); return; }
  // verify token...
});
```

---

## Performance

### How does StreetJS handle memory?

Every component has explicit bounds:

| Component | Bound |
|---|---|
| HTTP body | 1 MB default (configurable) |
| File uploads | Disk only — ≤128 KB heap |
| DB results | 256 rows buffered |
| LRU cache | `maxEntries` cap |
| Rate limiter | 100K IPs, 1K timestamps/IP |
| WebSocket connections | `maxConnections` |

### Does StreetJS support clustering?

Yes. Use `ClusterCoordinator` to spawn worker processes:

```typescript
import { ClusterCoordinator } from 'streetjs';

const coordinator = new ClusterCoordinator({ workers: 4 });
coordinator.start(() => bootstrap());
```

---

## Deployment

### Can I deploy StreetJS with Docker?

Yes. The generated `Dockerfile` uses a multi-stage build:

```bash
docker build -t my-api .
docker run -p 3000:3000 --env-file .env my-api
```

### Does StreetJS work behind a reverse proxy (nginx, Caddy)?

Yes. Set `HOST=0.0.0.0` and let the proxy handle TLS termination. Trust the `X-Forwarded-For` header for real IP detection in the rate limiter.

### What environment variables are required in production?

At minimum:
- `NODE_ENV=production`
- `JWT_SECRET` — at least 32 random characters
- `SESSION_KEY` — 64-character hex string
- `PG_HOST`, `PG_PORT`, `PG_DATABASE`, `PG_USER`, `PG_PASSWORD`

---

## Contributing

### How do I report a bug?

Open an issue at [github.com/hassanmubiru/issues](https://github.com/hassanmubiru/issues) with a minimal reproduction.

### How do I contribute code?

See the [Contributing Guide](/contributing/).

### Is there a roadmap?

See the [Roadmap](/roadmap/).

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "FAQPage",
  "mainEntity": [
    {"@type": "Question", "name": "Why StreetJS?", "acceptedAnswer": {"@type": "Answer", "text": "StreetJS is a batteries-included TypeScript backend framework built on Node.js core with a tiny dependency footprint. Auth, realtime, jobs, ORM, AI, and security are built in, so you can self-host a full backend cheaply without assembling many third-party services."}},
    {"@type": "Question", "name": "How does StreetJS compare to NestJS?", "acceptedAnswer": {"@type": "Answer", "text": "Both use decorators and dependency injection. StreetJS runs directly on Node core (no Express/Fastify adapter), ships a native PostgreSQL driver, and has a much smaller dependency tree. NestJS has a far larger ecosystem and community."}},
    {"@type": "Question", "name": "How does StreetJS compare to Fastify?", "acceptedAnswer": {"@type": "Answer", "text": "Both are performance-minded. Fastify is a fast router with a rich plugin ecosystem; StreetJS bundles DI, ORM, auth, and realtime as first-class features. Fastify has a larger, more mature ecosystem."}},
    {"@type": "Question", "name": "Is StreetJS production ready?", "acceptedAnswer": {"@type": "Answer", "text": "The engineering is published, signed, provenance-attested, and CI-green with runtime certification. It is suitable for solo developers, internal tools, and early adopters today. It is not yet a default for risk-averse enterprises needing a large ecosystem, hiring pool, audited compliance, and third-party production proof."}},
    {"@type": "Question", "name": "Is StreetJS open source?", "acceptedAnswer": {"@type": "Answer", "text": "Yes — MIT licensed, with public governance, an RFC process, and a signed plugin ecosystem."}},
    {"@type": "Question", "name": "What is the security model?", "acceptedAnswer": {"@type": "Answer", "text": "Built-in JWT/sessions/RBAC/MFA, rate limiting, validation, XSS sanitization, field-level encryption, vault mode, and mTLS. Supply chain is hardened with npm provenance, SBOMs, Ed25519-signed plugins, CodeQL, and secret scanning. Compliance materials are control mappings, not audited attestations."}},
    {"@type": "Question", "name": "How does the plugin model work?", "acceptedAnswer": {"@type": "Answer", "text": "Plugins extend a PluginModule SDK and ship an Ed25519-signed manifest verified against a trust key. Official plugins are signed with the project key in CI; a signature-enforcing host rejects tampered or untrusted manifests."}},
    {"@type": "Question", "name": "Does StreetJS support an ORM?", "acceptedAnswer": {"@type": "Answer", "text": "Yes — @streetjs/orm provides entity/relation decorators, eager loading (N+1-safe), and model-driven migration generation, on top of a safe parameterized query planner."}},
    {"@type": "Question", "name": "Does StreetJS support frontend frameworks?", "acceptedAnswer": {"@type": "Answer", "text": "Yes — a framework-agnostic @streetjs/client SDK plus React, Next, Vue, and Nuxt adapters and React UI kits, all consuming public APIs. No frontend dependency is added to core. These packages are 0.1.x previews."}}
  ]
}
</script>
