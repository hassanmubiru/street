---
layout:    default
title:     "Project Structure"
parent:    "Getting Started"
nav_order: 2
permalink: /getting-started/project-structure/
description: "StreetJS project structure — how a scaffolded TypeScript backend is organized: controllers, services, repositories and migrations."
---

# Project Structure

Understanding where every file lives and why helps you navigate the codebase confidently. This document explains every directory and its architectural role.

---

## Top-level layout

```
street/
├── package.json          # npm manifest, "type": "module"
├── tsconfig.json         # TypeScript strict config, NodeNext ESM
├── street-build.sh       # One-command build script
├── Dockerfile            # Multi-stage build → distroless runtime
├── .github/
│   └── workflows/
│       └── ci-cd.yml     # GitHub Actions: build, test, docker
├── src/                  # All TypeScript source
├── tests/                # Integration tests (compiled alongside src/)
├── migrations/           # Plain SQL migration files
├── uploads/              # Runtime upload destination (gitignored)
└── dist/                 # Compiled JavaScript output (gitignored)
```

---

## Source directory: `src/`

```
src/
├── main.ts               # Application entry point — CLI or HTTP boot
├── reflect-shim.d.ts     # Global Reflect.metadata type declarations
│
├── core/                 # Framework kernel
│   ├── types.ts          # Shared TypeScript type utilities
│   ├── context.ts        # StreetContext — per-request object
│   ├── container.ts      # IoC container + @Injectable
│   └── decorators.ts     # @Controller, @Get, @Post, @Validate, @Config, @Command
│
├── http/                 # HTTP layer
│   ├── server.ts         # streetApp() factory — HTTP server + body parser
│   ├── exceptions.ts     # Typed HTTP exceptions (400, 401, 404 ...)
│   ├── openapi.ts        # OpenAPI 3.1 spec generator
│   └── auth.middleware.ts# JWT auth, CORS, security headers middleware
│
├── router/
│   └── router.ts         # Compiled regex router, validation, pipeline runner
│
├── database/
│   ├── wire.ts           # PostgreSQL wire protocol v3 client
│   ├── pool.ts           # Bounded connection pool
│   ├── repository.ts     # Generic IRepository<T> + StreetPostgresRepository<T>
│   └── migrations.ts     # SQL migration runner with tracking table
│
├── security/
│   ├── jwt.ts            # HMAC-SHA256 JWT (sign, verify, decode)
│   ├── session.ts        # AES-256-GCM session encryption
│   ├── vault.ts          # KEK-based config decryption
│   ├── ratelimit.ts      # Sliding-window rate limiter
│   └── xss.ts            # Recursive XSS sanitizer
│
├── multipart/
│   └── parser.ts         # Streaming multipart/form-data parser
│
├── websocket/
│   ├── server.ts         # WebSocket server (ws), heartbeat, broadcast
│   └── sse.ts            # Server-Sent Events wrapper
│
├── cache/
│   └── lru.ts            # LRU cache with TTL and bounded entry count
│
├── telemetry/
│   └── tracker.ts        # Request telemetry, heap profiling, latency P50/P99
│
├── cluster/
│   └── coordinator.ts    # node:cluster coordinator, IPC heartbeat, auto-restart
│
├── webhook/
│   └── dispatcher.ts     # Async webhook queue, HMAC-signed HTTP dispatch
│
├── cli/
│   ├── kernel.ts         # CLI kernel, parseArgv, CliKernel class
│   └── commands.ts       # @Command implementations (migrate, user:*)
│
├── config/
│   └── index.ts          # AppConfig class, @Config-decorated fields
│
├── domain/
│   └── user.ts           # User entity, DTOs, validation schemas
│
├── services/
│   ├── user.service.ts   # UserService — business logic
│   └── user.repository.ts# UserRepository — typed DB access
│
└── controllers/
    ├── user.controller.ts # UserController — HTTP handler methods
    └── health.controller.ts# /api/health, /api/metrics, /api/openapi.json
```

---

## Dependency flow

The architecture follows a strict one-directional dependency graph. No layer imports from a layer above it:

```
main.ts
  └── config/           (loads environment)
  └── database/pool     (connects to PostgreSQL)
  └── services/         (business logic)
      └── database/repository  (data access)
          └── database/wire    (wire protocol)
  └── controllers/      (HTTP handlers)
      └── services/     (calls service methods)
      └── core/context  (reads/writes request)
  └── http/server       (routes to controllers)
      └── router/       (compiles and matches routes)
      └── core/container (resolves controller instances)
```

This means:
- Controllers never talk to `wire.ts` directly
- Services never import from `http/`
- The router never knows about PostgreSQL

This separation makes every layer independently testable and replaceable.

---

## The `migrations/` directory

```
migrations/
├── 001_create_users.sql              # Forward migration
├── 001_create_users.rollback.sql     # Rollback (drop)
├── 002_create_sessions_webhooks.sql
└── 002_create_sessions_webhooks.rollback.sql
```

Migrations are **plain SQL files**, sorted lexicographically. The leading timestamp prefix ensures correct execution order. Every migration has a companion `.rollback.sql` for safe rollback operations.

The migration runner tracks applied migrations in a `street_migrations` table. Re-running `migrate` is idempotent — already-applied migrations are skipped.

---

## The `tests/` directory

```
tests/
└── integration.test.ts    # Full integration tests, node:test + node:assert
```

Tests live outside `src/` but are compiled alongside it (both are included in `tsconfig.json`). This means:

- Tests are type-checked with the same strict rules as source
- Tests import from `../src/...` with full type safety
- Tests can be run immediately after `tsc` with `node --test`

There are no unit test stubs or mock frameworks. Every test runs against a real PostgreSQL instance and a real HTTP server.

---

## The `uploads/` directory

File uploads are streamed directly to this directory by the multipart parser. It must exist before the server starts — `street-build.sh` creates it automatically.

In production, mount this as a Docker volume or replace it with a cloud storage sink:

```bash
docker run -v /data/uploads:/app/uploads my-app
```

---

## The `dist/` directory

Never edit files in `dist/`. It is entirely regenerated on every `tsc` run. It is excluded from git via `.gitignore`.

```
dist/
├── src/          # Compiled source
└── tests/        # Compiled tests
```

---

## Naming conventions

| Pattern | Example | Rule |
|---|---|---|
| Files | `user.service.ts` | `<noun>.<role>.ts` |
| Classes | `UserService` | PascalCase |
| Interfaces | `IRepository<T>` | `I` prefix for contracts |
| Types | `ParsedFile` | PascalCase |
| Constants | `MAX_BODY_BYTES` | SCREAMING_SNAKE |
| Private fields | `_config` | `_` prefix for unused-but-injected |
| Decorators | `@Injectable()` | Applied in declaration order |

---

## Adding a new feature

To add a new resource (e.g. `Product`), follow this checklist:

```
1. src/domain/product.ts          — entity, DTOs, validation schemas
2. src/services/product.repository.ts  — extends StreetPostgresRepository<Product>
3. src/services/product.service.ts     — business logic, @Injectable
4. src/controllers/product.controller.ts — @Controller, route handlers
5. migrations/003_create_products.sql — CREATE TABLE
6. Register controller in src/main.ts
```

That is the complete change set. No framework configuration, no module registration files, no factory wiring.
