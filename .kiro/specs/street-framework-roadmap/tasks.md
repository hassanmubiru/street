# Implementation Tasks: Street Framework Roadmap v1.1 – v3.0

- [ ] 1. v1.1 — Hot Reload Development Server
  - [ ] 1.1 Create `packages/core/src/dev/watcher.ts` with `DevWatcher` class: `FSWatcher` handle management, `WatcherOptions` interface, `start()` and `stop()` methods, stores all watcher handles in an array for cleanup
  - [ ] 1.2 Implement incremental TypeScript compilation in `DevWatcher`: spawn `tsc --incremental` as a child process, capture stdout/stderr, return boolean success/failure from `compile()`
  - [ ] 1.3 Implement graceful server restart in `DevWatcher.restartServer()`: send `SIGTERM` to the current server process, wait for drain up to `drainTimeoutMs` (default 5000ms), then spawn fresh process
  - [ ] 1.4 Wire `DevWatcher` into `packages/cli/src/commands/dev.ts`: read `--watch` flag, instantiate `DevWatcher`, call `start()`, register `SIGINT`/`SIGTERM` handlers that call `stop()`
  - [ ] 1.5 Write integration tests in `packages/cli/src/tests/dev.test.ts`: verify FSWatcher handles are closed on stop, verify recompile triggers on file save, verify error output on type errors keeps previous server running
  - [ ] 1.6 Export `DevWatcher` and `WatcherOptions` from `packages/core/src/index.ts`

- [ ] 2. v1.1 — Code Generators (middleware, gateway, migration)
  - [ ] 2.1 Create generator templates in `packages/cli/templates/generate/`: `middleware.ts.tpl`, `gateway.ts.tpl`, `migration-up.sql.tpl`, `migration-rollback.sql.tpl`
  - [ ] 2.2 Implement `generateMiddleware(name, cwd)` in `packages/cli/src/commands/generate.ts`: validate name with `/^[a-z][a-z0-9_-]*$/`, check target file existence (exit 1 if exists), write typed `StreetMiddleware` function scaffold to `src/middleware/<name>.middleware.ts`
  - [ ] 2.3 Implement `generateGateway(name, cwd)`: write `@Injectable()` + `@WebSocketGateway` scaffold with `onConnect`, `onMessage`, `onDisconnect` handlers to `src/gateways/<name>.gateway.ts`
  - [ ] 2.4 Implement `generateMigration(name, cwd)`: create timestamped `migrations/<timestamp>_<name>.sql` and `migrations/<timestamp>_<name>.rollback.sql` files
  - [ ] 2.5 Extend `GenerateCommand.execute()` switch to route `middleware`, `gateway`, `migration` sub-types to their respective functions
  - [ ] 2.6 Write tests in `packages/cli/src/tests/generate.test.ts`: verify each generator creates the correct files, verify exit 1 on duplicate, verify name validation rejects uppercase/special chars

- [ ] 3. v1.1 — Configuration Validation Engine
  - [ ] 3.1 Create `packages/core/src/config/validator.ts`: define `FieldType` union (`string | number | boolean | url | port`), `ConfigFieldDef` interface, `ConfigSchema` type, `ConfigResult<S>` mapped type
  - [ ] 3.2 Implement `defineConfig<S extends ConfigSchema>(schema: S): ConfigResult<S>`: reads `process.env`, validates each field against its type and constraints, collects ALL errors before throwing, throws `ConfigValidationError` with the full error list
  - [ ] 3.3 Implement `ConfigValidationError` class extending `Error` with `errors: string[]` property
  - [ ] 3.4 Add `url` type validation (uses `new URL()`) and `port` type validation (integer 1–65535) to the field validator
  - [ ] 3.5 Apply default values only when the variable is absent; treat present-but-invalid values as errors regardless of default
  - [ ] 3.6 Export `defineConfig` and `ConfigValidationError` from `packages/core/src/index.ts`
  - [ ] 3.7 Write unit tests covering: missing required field, invalid port range, malformed URL, default applied on absent var, error on present-but-invalid var, multi-error collection

- [ ] 4. v1.1 — Enhanced Error Diagnostics
  - [ ] 4.1 Create `packages/core/src/diagnostics/reporter.ts`: `DiagnosticsReporter` class extending `EventEmitter`, `DiagnosticEvent` interface with `errorClass`, `message`, `stack[]`, `correlationId`, `ts` fields
  - [ ] 4.2 Implement `DiagnosticsReporter.report(err, correlationId?)`: serialize to JSON, strip Node.js internal frames (filter lines matching `/node:internal|node_modules\/node/`), emit `diagnostic` event, write to `process.stderr`
  - [ ] 4.3 Replace `console.error` in `packages/core/src/router/router.ts`'s `errorHandler` with `DiagnosticsReporter.report()`
  - [ ] 4.4 Enrich `Container.resolve()` error message with the full dependency chain on resolution failure: `"Cannot resolve X → Y → Z: <reason>"`
  - [ ] 4.5 Add `DatabaseConnectionError` class to `packages/core/src/http/exceptions.ts` with a `suggestion` field; throw it from `PgPool.initialize()` on `ECONNREFUSED` with relevant env var names
  - [ ] 4.6 Export `DiagnosticsReporter` and `DiagnosticEvent` from `packages/core/src/index.ts`
  - [ ] 4.7 Write tests: verify `diagnostic` event fires on unhandled route error, verify stack frames are cleaned, verify dependency chain appears in DI error messages

- [ ] 5. v1.1 — CLI Operational Commands (info, doctor, env validate, audit)
  - [ ] 5.1 Create `packages/cli/src/commands/info.ts` with `InfoCommand`: read `package.json` for Street version, read `process.version` for Node, detect TypeScript version from `node_modules/typescript/package.json`, print aligned table
  - [ ] 5.2 Create `packages/cli/src/commands/doctor.ts` with `DoctorCommand`: check Node.js >= 20, TypeScript >= 5.0, required env vars from `.env.example`, attempt DB connectivity ping via `PgConnection.connect()`; print ✓/✗ per check with versions and upgrade hints
  - [ ] 5.3 Create env-validate logic in `DoctorCommand` (or separate `EnvValidateCommand`): dynamic-import `street.config.ts` from the project root, call `defineConfig()`, report per-variable pass/fail, exit code 0 or 1
  - [ ] 5.4 Create `packages/cli/src/commands/audit.ts` with `AuditCommand`: spawn `npm audit --json`, parse JSON output, format CVE findings as a table with package name, severity, and fix recommendation
  - [ ] 5.5 Register all new commands (`info`, `doctor`, `env`, `audit`) in `packages/cli/src/index.ts` switch
  - [ ] 5.6 Write tests for `InfoCommand` (reads correct versions), `DoctorCommand` (detects old Node version as failure), `AuditCommand` (parses npm audit JSON output)


- [ ] 6. v1.2 — MySQL Wire Protocol Driver
  - [ ] 6.1 Create `packages/core/src/database/mysql/wire.ts`: implement MySQL Client/Server Protocol v4.1 handshake over `node:net`; parse server greeting packet (capabilities, server version, auth plugin)
  - [ ] 6.2 Implement `mysql_native_password` authentication: `SHA1(password) XOR SHA1(seed + SHA1(SHA1(password)))` using `node:crypto`
  - [ ] 6.3 Implement `caching_sha2_password` authentication: full SHA-256 challenge-response using `node:crypto`
  - [ ] 6.4 Implement `MysqlConnection.query(sql, params)`: use parameterized COM_STMT_PREPARE + COM_STMT_EXECUTE; return `DbResult { rows, rowCount, command }`
  - [ ] 6.5 Implement `MysqlConnection.queryStream(sql)`: return a `Readable` that emits row objects with backpressure via `socket.pause()`/`socket.resume()`
  - [ ] 6.6 Create `packages/core/src/database/mysql/pool.ts` with `MysqlPool`: same min/max/acquire/idle-sweep API as `PgPool`
  - [ ] 6.7 Create `packages/core/src/database/mysql/mariadb.ts`: `MariaDbConnection` subclass handling MariaDB-specific capability flags; `MysqlConnection.connect()` detects server greeting and returns the appropriate subclass
  - [ ] 6.8 Write integration tests against a real MySQL instance: connection, simple query, parameterized query, transaction commit, transaction rollback, concurrent queries
  - [ ] 6.9 Export `MysqlConnection`, `MysqlPool`, `MariaDbConnection` from `packages/core/src/index.ts`

- [ ] 7. v1.2 — SQLite Driver (WASM worker)
  - [ ] 7.1 Bundle a SQLite WASM binary (`sqlite3.wasm`) into `packages/core/src/database/sqlite/`; document the source and build steps in `CONTRIBUTING.md`
  - [ ] 7.2 Create `packages/core/src/database/sqlite/worker.ts`: load and instantiate the WASM module inside a `node:worker_threads` worker; handle `query` and `transaction` messages via `MessageChannel`
  - [ ] 7.3 Create `packages/core/src/database/sqlite/pool.ts` with `SqlitePool`: constructor accepts `{ filePath, maxWorkers? }`; routes queries to available worker threads; supports `query()` and `transaction()` methods
  - [ ] 7.4 Implement `DbResult` as a shared type across all three drivers (PG, MySQL, SQLite) in `packages/core/src/database/types.ts`; update existing `PgResult` to be an alias
  - [ ] 7.5 Write integration tests against a real SQLite file: create table, insert, query, transaction rollback, concurrent reads
  - [ ] 7.6 Export `SqlitePool` from `packages/core/src/index.ts`

- [ ] 8. v1.2 — Type-Safe Query Builder
  - [ ] 8.1 Create `packages/core/src/database/query-builder.ts` with `QueryBuilder<T extends object>` class: internal AST state with arrays for `selects`, `wheres`, `joins`, `orderBys`, `groupBys`, `havings`; `limit` and `offset` number fields
  - [ ] 8.2 Implement all fluent methods: `select()`, `from()`, `where()`, `join()`, `leftJoin()`, `orderBy()`, `groupBy()`, `having()`, `limit()`, `offset()`, `subquery()`; each returns `this`
  - [ ] 8.3 Implement `build()`: render all accumulated state into `{ sql: string; params: unknown[] }` with positional `$1`/`?` placeholders per `SqlDialect` enum
  - [ ] 8.4 Add compile-time column name enforcement: `select(...cols: (keyof T & string)[])` and `where()` column parameter typed as `keyof T & string`; non-existent column produces a TypeScript error
  - [ ] 8.5 Implement idempotent build: calling `build()` twice on the same unmodified builder produces identical output
  - [ ] 8.6 Write tests: select with where and limit, join with subquery, idempotent build, parameterized placeholder count matches params array length, dialect-specific placeholder style

- [ ] 9. v1.2 — Schema Introspection
  - [ ] 9.1 Create `packages/core/src/database/schema-inspector.ts`: define `ColumnMeta`, `IndexMeta`, `FkMeta`, `TableSchema`, `DatabaseSchema` interfaces
  - [ ] 9.2 Implement PostgreSQL introspection queries: batch `information_schema.columns`, `pg_indexes`, `information_schema.table_constraints`, `information_schema.referential_constraints` into minimal round-trips; complete within 1 second for 500-table schemas
  - [ ] 9.3 Implement MySQL introspection queries using `information_schema` catalog tables
  - [ ] 9.4 Implement SQLite introspection using `PRAGMA table_info()`, `PRAGMA index_list()`, `PRAGMA foreign_key_list()`
  - [ ] 9.5 Implement result caching: `Map<pool, { schema: DatabaseSchema; expiresAt: number }>` with 60-second default TTL; `invalidateCache(pool)` removes the entry
  - [ ] 9.6 Write integration tests: inspect a known schema, verify all column types and nullable flags, verify 60s cache TTL, verify invalidation forces re-fetch

- [ ] 10. v1.2 — Migration Diffing, Seeding, Query Profiling, and Connection Diagnostics
  - [ ] 10.1 Create `packages/core/src/database/migrations.ts` additions: `MigrationDiffer.diff(pool, entities)` reads live schema via `SchemaInspector`, compares to entity decorator metadata, returns `{ safe: string[], destructive: string[] }`
  - [ ] 10.2 Add `street migrate:diff` CLI command: call `MigrationDiffer.diff()`, write generated SQL to timestamped file; require `--confirm-destructive` flag before writing any destructive statements
  - [ ] 10.3 Create `packages/core/src/database/seeder.ts` with `StreetSeeder.run(pool, seedFile)`: wrap execution in `pool.transaction()`; track runs in `street_seed_runs` table using file content hash; skip already-applied seeds
  - [ ] 10.4 Add `street db:seed <file>` CLI command wired to `StreetSeeder`
  - [ ] 10.5 Create `packages/core/src/database/profiler.ts` with `QueryProfiler`: ring buffer of 10,000 `QueryRecord` entries; `enable(pool)` wraps `pool.query()` with a timing decorator via composition (no prototype patching); `getSlowQueries(thresholdMs)` returns sorted results
  - [ ] 10.6 Implement `ConnectionDiagnostics.ping(pool)`: send `SELECT 1` and measure round-trip; `poolStats(pool)` returns `{ total, idle, inUse, waiting, avgAcquireMs }`
  - [ ] 10.7 Emit `pool:exhausted` event on `PgPool`'s internal `EventEmitter` before enqueueing a wait request when the pool is full
  - [ ] 10.8 Write tests: seed runs are idempotent (same hash → skip), diff detects added column, profiler records slow queries, `pool:exhausted` fires on pool saturation


- [ ] 11. v1.3 — OpenTelemetry Integration
  - [ ] 11.1 Create `packages/core/src/observability/otel.ts`: define `SpanContext`, `Span`, and `OtelTracer` interfaces; implement span lifecycle (`startSpan`, `end`) with `process.hrtime.bigint()` timing
  - [ ] 11.2 Implement W3C `traceparent` header parsing in `OtelTracer.extractContext()` and injection in `OtelTracer.injectContext()` per the W3C Trace Context spec
  - [ ] 11.3 Implement OTLP HTTP exporter in `OtelTracer`: serialize spans to OTLP JSON format, POST to `OTEL_EXPORTER_OTLP_ENDPOINT` using `node:https`; batch up to 1,000 spans; flush every 5 seconds
  - [ ] 11.4 Implement retry with exponential backoff on OTLP export failure; emit a single `warn` log per drop event when the buffer overflows
  - [ ] 11.5 Create `otelMiddleware(tracer)` factory: extract context from `traceparent`, start HTTP span, call `next()`, end span with response status; store span in `ctx.state['otelSpan']`
  - [ ] 11.6 Instrument `PgPool.query()` to create a child span when `ctx.state['otelSpan']` is present; span attributes: `db.system`, `db.statement`, duration
  - [ ] 11.7 Call `OtelTracer.flush()` during graceful shutdown (before pool close) to drain buffered spans
  - [ ] 11.8 Export `OtelTracer`, `otelMiddleware`, `SpanContext` from `packages/core/src/index.ts`
  - [ ] 11.9 Write integration tests: parent-child span relationship is correct, `traceparent` round-trip, buffer capped at 1,000, flush called on shutdown

- [ ] 12. v1.3 — Structured Logging
  - [ ] 12.1 Create `packages/core/src/observability/logger.ts`: `Logger` class, `LogLevel` type, `LogEntry` interface with `timestamp`, `level`, `message`, `correlationId`, `service` fields
  - [ ] 12.2 Implement `Logger.debug/info/warn/error(msg, meta?)`: serialize to JSON `LogEntry` and write to `outputStream` (default `process.stderr`); suppress entries below configured `level`
  - [ ] 12.3 Implement `Logger.child(bindings)`: return a new `Logger` instance with bindings merged into every entry; used for per-request loggers with `correlationId` pre-set
  - [ ] 12.4 Implement `Error` serialization: if any `meta` value is an `Error` instance, replace it with `{ name, message, stack }` before `JSON.stringify`
  - [ ] 12.5 Implement dev pretty-formatter: when `NODE_ENV=development`, output colorized single-line text to the terminal in addition to JSON to `outputStream`
  - [ ] 12.6 Create `correlationMiddleware(logger)`: generate UUID v4 correlation ID or extract from `X-Correlation-ID` header; store in `ctx.state['correlationId']`; create child logger in `ctx.state['logger']`; set `X-Correlation-ID` response header
  - [ ] 12.7 Make `Logger` injectable via the DI container by decorating it with `@Injectable()`
  - [ ] 12.8 Export `Logger`, `LogLevel`, `LogEntry`, `correlationMiddleware` from `packages/core/src/index.ts`
  - [ ] 12.9 Write tests: JSON output structure, level filtering, Error serialization, correlation ID propagation to child logger, pretty formatter in dev mode

- [ ] 13. v1.3 — Prometheus Metrics Exporter
  - [ ] 13.1 Create `packages/core/src/observability/prometheus.ts`: `MetricsRegistry`, `Counter`, `Gauge`, `Histogram` classes; `MetricConflictError` exception
  - [ ] 13.2 Implement `Counter.inc(labels?, value?)`, `Gauge.set(value, labels?)`, `Histogram.observe(value, labels?)`: store label-keyed values in `Map<string, number>` (synchronous, event-loop-safe)
  - [ ] 13.3 Implement `MetricsRegistry.collect()`: render all registered metrics to Prometheus text exposition format 0.0.4 with correct `# HELP`, `# TYPE`, and metric lines; return as `string`
  - [ ] 13.4 Register default metrics: `http_requests_total` (counter), `http_request_duration_seconds` (histogram with buckets 0.005–10), `process_heap_bytes` (gauge), `db_pool_connections` (gauge) in `prometheusMiddleware(registry, pool?)`
  - [ ] 13.5 Throw `MetricConflictError` synchronously at registration time if a metric name is already registered
  - [ ] 13.6 Register `GET /metrics` route in `StreetApp` when `prometheusMiddleware` is used; set correct `Content-Type` header
  - [ ] 13.7 Export `MetricsRegistry`, `prometheusMiddleware`, `MetricConflictError` from `packages/core/src/index.ts`
  - [ ] 13.8 Write tests: Prometheus text format is valid, concurrent scrapes produce consistent snapshots, conflict detection, default metrics are present

- [ ] 14. v1.3 — Health Check DSL
  - [ ] 14.1 Create `packages/core/src/observability/health.ts`: `HealthCheckRegistry`, `CheckFn`, `CheckResult`, `HealthResponse`, `CheckType` types
  - [ ] 14.2 Implement `HealthCheckRegistry.addCheck(name, fn, opts)`: store checks in a `Map<string, { fn, type, timeoutMs }>`
  - [ ] 14.3 Implement `HealthCheckRegistry.runLiveness()` and `runReadiness()`: execute all matching checks in parallel with `Promise.allSettled()`; wrap each in `Promise.race([fn(), timeoutPromise])`; mark any that reject or time out as `down`; return `HealthResponse`
  - [ ] 14.4 Create `registerHealthRoutes(app, registry)`: register `GET /health/live` and `GET /health/ready` on `StreetApp`; respond 200 on all `up`, 503 on any `down`
  - [ ] 14.5 Export `HealthCheckRegistry`, `registerHealthRoutes`, `CheckResult` from `packages/core/src/index.ts`
  - [ ] 14.6 Write tests: all-up returns 200, one-down returns 503 with body listing the failed check, timed-out check marked `down`, thrown exception caught and marked `down`

- [ ] 15. v1.3 — Request Profiler and Diagnostics Dashboard
  - [ ] 15.1 Create `packages/core/src/diagnostics/route-profiler.ts` with `RouteProfiler`: `Map<routeKey, CircularBuffer<LatencySample>>` capped at 10,000 samples per route; `record(method, pattern, latencyNs, isError)` and `stats(method, pattern)` returning `RouteStats` with P50/P95/P99
  - [ ] 15.2 Integrate `RouteProfiler` into the `Router.dispatch()` path: record latency after every dispatched request
  - [ ] 15.3 Create `packages/core/src/diagnostics/socket-server.ts` with `DiagnosticsServer`: listen on Unix domain socket `/tmp/street-<pid>.sock`; accept connections; push JSON snapshots from `RouteProfiler` and `process.memoryUsage()` every 1 second
  - [ ] 15.4 Create `packages/cli/src/commands/diagnostics.ts`: connect to the running process's Unix socket (detect PID from `--pid` flag or environment); render live terminal table with ANSI escape sequences; refresh every 1 second
  - [ ] 15.5 Implement stale socket detection in the CLI: check if the PID is alive via `process.kill(pid, 0)`; if not, remove the stale socket file and print a warning
  - [ ] 15.6 Ensure `DiagnosticsServer.stop()` removes the socket file and closes all client connections
  - [ ] 15.7 Write tests: ring buffer caps at 10,000 samples, P99 is calculated correctly, socket server sends JSON on connection, stale socket is cleaned up


- [ ] 16. v1.4 — OAuth2 and OpenID Connect
  - [ ] 16.1 Create `packages/core/src/auth/oauth2.ts`: `OAuthProvider`, `OAuthProfile`, `OAuthTokens`, `OAuthSuccessCallback` interfaces; `OAuthManager` class
  - [ ] 16.2 Implement PKCE generation: `code_verifier` = 32 random bytes as base64url; `code_challenge` = `S256` (SHA-256 of verifier) using `node:crypto`; store both in the encrypted session before redirect
  - [ ] 16.3 Implement `OAuthManager.authorizationUrl(provider)`: construct the provider's authorization URL with `response_type=code`, `client_id`, `redirect_uri`, `scope`, `state`, and `code_challenge` params
  - [ ] 16.4 Implement `OAuthManager.handleCallback(provider, code, state, sessionState, codeVerifier)`: validate `state` with `timingSafeEqual`, exchange code for tokens at provider's token endpoint via `node:https`
  - [ ] 16.5 Create `JwksCache` class: fetch provider JWKS on first use, cache for 5 minutes, serve from cache on subsequent calls; fall back to cached keys for up to 5 minutes if provider is unreachable
  - [ ] 16.6 Implement OIDC ID token validation: decode JWT header to get `kid`, look up public key in `JwksCache`, verify RS256/ES256 signature using `node:crypto`'s `verify()`; enforce `exp`, `aud`, `iss` claims
  - [ ] 16.7 Create built-in provider configs for Google (`accounts.google.com`), GitHub (`github.com`), and Microsoft (`login.microsoftonline.com`)
  - [ ] 16.8 Write `oauth2.test.ts` integration tests: PKCE code challenge matches verifier, state round-trip, invalid state rejected with 400, JWKS cache serves stale on provider failure

- [ ] 17. v1.4 — API Keys
  - [ ] 17.1 Create `packages/core/src/auth/api-keys.ts` with `ApiKeyService` class, `ApiKey` interface; write `street_api_keys` migration SQL file
  - [ ] 17.2 Implement `ApiKeyService.generate(opts)`: generate `randomBytes(32).toString('base64url')` prefixed with configurable namespace; store `createHash('sha256').update(rawKey).digest('hex')` in DB; return the raw key once only
  - [ ] 17.3 Implement `ApiKeyService.verify(rawKey)`: compute SHA-256 hash; query DB for matching hash; use `timingSafeEqual` with equal-length check; check `expiresAt`; use `LruCache` for 60-second result caching
  - [ ] 17.4 Implement `ApiKeyService.revoke(id)`: delete from DB; remove from `LruCache` immediately
  - [ ] 17.5 Create `apiKeyMiddleware(service)`: extract `Authorization: Bearer <key>`, call `service.verify()`, set `ctx.user`; throw `UnauthorizedException` on invalid/expired key
  - [ ] 17.6 Write tests: key generation produces correct prefix, only hash stored in DB, timing-safe comparison, revocation invalidates cache, expired key returns 401

- [ ] 18. v1.4 — Refresh Tokens and Token Rotation
  - [ ] 18.1 Create `packages/core/src/auth/refresh-tokens.ts` with `RefreshTokenService`; write `street_refresh_tokens` migration SQL
  - [ ] 18.2 Implement `RefreshTokenService.issue(userId, familyId?)`: generate new `familyId` (if not provided) from `randomBytes(16)`, issue access token (15 min) and refresh token (30 days), store only SHA-256 hash of refresh token
  - [ ] 18.3 Implement `RefreshTokenService.rotate(rawRefreshToken)`: inside a single `pool.transaction()`: hash the token, find and verify it, check `revoked_at IS NULL`; if already revoked → call `revokeFamily()` and throw `TokenReplayError`; otherwise atomically create new tokens and set `revoked_at` on the old one
  - [ ] 18.4 Implement `RefreshTokenService.revokeFamily(familyId)`: `UPDATE street_refresh_tokens SET revoked_at = NOW() WHERE family_id = $1`
  - [ ] 18.5 Export `RefreshTokenService`, `TokenReplayError` from `packages/core/src/index.ts`
  - [ ] 18.6 Write tests: rotation invalidates old token, replay attack revokes whole family, rotation invariant (old token invalid after rotation, new token valid), configurable lifetimes respected

- [ ] 19. v1.4 — RBAC and Permission Decorators
  - [ ] 19.1 Create `packages/core/src/auth/rbac.ts`: `RoleHierarchy` type, `RbacService` class, `@Roles()` and `@Permissions()` method decorators, `rbacGuard(service)` middleware factory
  - [ ] 19.2 Implement `RbacService` constructor: traverse hierarchy using BFS to build a `Map<role, Set<string>>` of flattened permissions; store at construction time for synchronous lookups
  - [ ] 19.3 Implement `@Roles(...roles)` decorator: store roles on route metadata under `street:roles` key using `Reflect.defineMetadata`
  - [ ] 19.4 Implement `@Permissions(...perms)` decorator: store permissions under `street:permissions` key
  - [ ] 19.5 Implement `rbacGuard(service)` middleware: read metadata from the route handler class/method; call `service.hasRole()` or `service.hasPermission()`; throw `ForbiddenException` with `{ error: 'Forbidden', required: string[] }` on failure
  - [ ] 19.6 Write tests: role inheritance resolves permissions, `@Roles` guard blocks non-matching roles with 403, `@Permissions` guard blocks missing permission, synchronous resolution (no DB calls)

- [ ] 20. v1.4 — WebAuthn / Passkeys
  - [ ] 20.1 Create `packages/core/src/auth/webauthn.ts` with `WebAuthnService`; write `street_webauthn_credentials` migration SQL
  - [ ] 20.2 Implement a minimal CBOR decoder in `packages/core/src/auth/cbor.ts` using `node:buffer`; handle the subset of CBOR used in WebAuthn attestation and assertion objects
  - [ ] 20.3 Implement `WebAuthnService.beginRegistration(userId)`: generate 16+ byte random challenge; store in session with 60-second expiry; return `PublicKeyCredentialCreationOptions` JSON
  - [ ] 20.4 Implement `WebAuthnService.finishRegistration(userId, credential)`: verify challenge from session (check expiry), validate origin and rpId, decode CBOR attestation, store public key and initial `signCount`
  - [ ] 20.5 Implement `WebAuthnService.beginAuthentication(userId)`: generate challenge; store in session
  - [ ] 20.6 Implement `WebAuthnService.finishAuthentication(userId, assertion)`: verify challenge, verify assertion signature against stored public key using `node:crypto`'s `createVerify()`; enforce `signCount > stored` (replay protection); update stored `signCount`
  - [ ] 20.7 Write tests: expired challenge returns 400 with `challenge_expired`, signature verification rejects tampered assertion, sign count replay protection, round-trip registration + authentication

- [ ] 21. v1.4 — Session Revocation and Audit Trails
  - [ ] 21.1 Create `packages/core/src/auth/session-store.ts` with `StreetSessionStore`: backed by `street_sessions` DB table; `create(data)`, `find(sessionId)`, `revoke(sessionId)`, `revokeAll(userId)` methods; write migration SQL
  - [ ] 21.2 Implement revocation check middleware: on every authenticated request, check session ID against a `LruCache<string, boolean>` revocation set (DB fallback on cache miss); throw `UnauthorizedException` if revoked
  - [ ] 21.3 Create `packages/core/src/auth/audit-writer.ts` with `AuditWriter` class; write `street_audit_log` migration SQL with `append-only` database trigger or rule
  - [ ] 21.4 Implement `AuditWriter.write(record)`: inside a transaction, write the audit entry; if the write fails, re-throw so the calling transaction rolls back
  - [ ] 21.5 Integrate `AuditWriter` into auth flows: call `write()` after login success, login failure, logout, token refresh, session revocation, and permission denial
  - [ ] 21.6 Write tests: revoked session returns 401 on next request, audit log entry written for each of the 6 event types, failed audit write causes transaction rollback, audit log cannot be deleted via public API

