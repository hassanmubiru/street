# Changelog

All notable changes to `@streetjs/core` are documented here.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Versioning follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [1.0.0] — 2024-01-15

### Added

**Core**
- IoC container with singleton registry, recursive dependency resolution, and circular dependency detection
- `@Injectable()` decorator using `reflect-metadata` constructor type emission
- `@Controller`, `@Get`, `@Post`, `@Put`, `@Patch`, `@Delete`, `@Validate`, `@ApiOperation`, `@Config`, `@Command` decorators
- `StreetContext` per-request object with typed request/response API
- `streetApp()` factory: native `node:http` server, body parser (JSON + multipart), request timeout

**Database**
- PostgreSQL wire protocol v3 client (`node:net` + `node:crypto` only) — no `pg` dependency
- MD5 and cleartext authentication
- `PgConnection.query()` buffered and `PgConnection.queryStream()` streaming
- `StreetPostgresWireStream` with socket-level backpressure
- `PgPool` bounded connection pool with idle sweep and acquire queue
- `StreetPostgresRepository<T>` generic repository with CRUD + pagination
- `LedgerTransactionService` for multi-operation ACID transactions
- `StreetMigrationRunner` ordered idempotent SQL migrations with tracking table

**Security**
- `JwtService`: HMAC-SHA256 sign/verify with `timingSafeEqual`
- `SessionManager`: AES-256-GCM encrypt/decrypt with random IV per call
- Vault Mode: scrypt key derivation + AES-256-GCM for KEK-based config decryption
- `RateLimiter`: sliding-window, BigInt nanosecond precision, bounded per-IP log
- `sanitizeDeep`: recursive XSS sanitizer (strips HTML, JS protocol, event handlers)
- `authMiddleware`, `requireRoles`, `securityHeaders`, `corsMiddleware`

**Realtime**
- `StreetWebSocketServer`: heartbeat, bounded connections, broadcast, `ws` library
- `StreetSocket`: typed event emitter with bounded listener count
- `SseConnection`: SSE wrapper with heartbeat keep-alive, clean close

**Storage**
- `MultipartParser`: streaming multipart/form-data directly to disk, ≤128 KB heap per request

**Performance**
- `LruCache<K,V>`: doubly-linked-list LRU, TTL expiry, periodic sweep
- `TelemetryTracker`: ring-buffer history (1,440 samples max), P50/P99 latency, heap profiling
- `ClusterCoordinator`: `node:cluster` worker management, IPC heartbeat, auto-restart
- `WebhookDispatcher`: HMAC-SHA256 signed outbound HTTP, bounded queue, exponential backoff

**CLI**
- `CliKernel`: `@Command` decorator dispatch with DI, `parseArgv` flag parser
- Dual-mode `main.ts`: CLI when `argv` contains a command, HTTP server otherwise

**Observability**
- `/api/health` endpoint: DB check, pool stats, heap, latency
- `/api/metrics` endpoint: telemetry history
- `/api/openapi.json`: auto-generated OpenAPI 3.1 spec from route decorators
