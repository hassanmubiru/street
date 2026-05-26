# Changelog

All notable changes to `@streetjs/core` are documented here.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Versioning follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [1.0.1] — 2026-05-27

### Fixed

**CI security bugs**
- `publish.yml`: replaced `secrets.NPM_TOKEN` in `if:` condition with an env-var workaround (GitHub Actions does not allow the `secrets` context in conditionals)
- `publish.yml`: removed `|| true` build error masking — compile failures are now correctly caught before publishing
- `ci-cd.yml`: added `permissions: contents: read` to restrict default write-all scope (Poisoned Pipeline Execution prevention)
- `ci-cd.yml`: replaced hardcoded test credentials (`POSTGRES_PASSWORD`, `JWT_SECRET`, `SESSION_KEY`, `KEK`) with `${{ secrets.XXX }}` references

### Changed

**Workflow quality-of-life**
- `ci-cd.yml`: added `concurrency` with `cancel-in-progress: true` to cancel stale duplicate CI runs
- `ci-cd.yml`: scoped `KEK` secret from workflow-level env to only the `build-and-test` job that needs it
- `ci-cd.yml`: deduplicated redundant `npx tsc --noEmit` + `npx tsc` into a single compilation step
- `ci-cd.yml`: changed `if: always()` → `if: success() || failure()` to skip artifact upload on cancelled workflows
- `ci-cd.yml`: completed the `docker-build` job — added `docker/login-action` for GHCR authentication and `docker push` for both commit-tagged and `latest` images
- `memory-leak.yml`: added `concurrency` and branch-filtered triggers to `[main, develop]` to reduce wasted runner cycles
- `publish.yml`: added `cache: 'npm'` to `setup-node` and `concurrency` to serialize publish runs
- All three workflows: pinned actions (`checkout`, `setup-node`, `upload-artifact`) to immutable commit SHAs instead of mutable `@v4` tags (supply-chain hardening)

### Added

**Automated security linting**
- `.github/workflows/security-lint.yml`: new workflow that runs [zizmor](https://github.com/zizmorcore/zizmor) on every push/PR to `main`/`develop`, scanning all workflow files for security vulnerabilities at `medium`+ severity

**Dependency lifecycle automation**
- `.github/dependabot.yml`: Dependabot config to automatically update SHA-pinned GitHub Actions and npm dependencies via weekly grouped PRs

**Developer tooling**
- `.vscode/settings.json`: associates the official GitHub Actions JSON schema with all `.github/workflows/*.yml` files — eliminates false-positive errors on `${{ secrets.XXX }}` and `if:` syntax in VS Code
- `.vscode/extensions.json`: recommends the Red Hat YAML extension (`redhat.vscode-yaml`) to workspace contributors
- `.githooks/pre-commit`: pre-commit hook that validates workflow YAML only when workflow files are staged
- `scripts/validate-workflows.sh`: standalone YAML validation script using PyYAML
- `"lint:workflows"` npm script: run `npm run lint:workflows` to validate workflow YAML manually
- `"lint:security"` npm script: run `npm run lint:security` to run zizmor locally (if installed)
- `"prepare"` npm script: auto-configures `core.hooksPath .githooks` on `npm install` / `npm ci`

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
