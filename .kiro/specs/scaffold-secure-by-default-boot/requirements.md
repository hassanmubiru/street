# Requirements Document

## Introduction

This feature governs what the streetJS project generator (`street create`, implemented in `packages/cli/src/commands/create.ts`) emits so that a freshly generated backend is **secure-by-default** and **boots successfully out-of-the-box** with no manual configuration. The scope is strictly the templated files the generator writes — `src/main.ts`, `.env.example`, `docker-compose.yml`, and `src/repositories/example.repository.ts` — together with reliance on existing `streetjs` runtime exports (notably `ServiceUnavailableException`).

Two groups of behavior are captured:

1. **Established behavior** (already implemented, committed, and verified by the CLI test suite: 102 + 50 tests, zero failures) — recorded here as the intended contract so future changes do not regress it.
2. **In-flight behavior** (configurable CORS, env/compose discoverability, and an unauthenticated-routes notice) — recorded so scope is agreed before re-implementation. On disk today this is partially present and inconsistent: the generated `main.ts` computes a CORS allowlist but still applies a hardcoded `corsMiddleware(['*'])`; the SQLite `.env.example` lists `CORS_ORIGINS` while the Postgres variant does not; and neither `docker-compose` env block lists `CORS_ORIGINS`.

This document is the requirements phase only. No code changes are made here.

## Glossary

- **Project_Generator**: The `street create <name>` command implemented in `packages/cli/src/commands/create.ts`, which writes templated project files to disk.
- **Generated_App**: The scaffolded backend application at runtime, whose entry point is the generated `src/main.ts`.
- **Secret_Resolver**: The `resolveSecret` helper inside the generated `src/main.ts` that resolves `JWT_SECRET` and `SESSION_KEY`.
- **CORS_Resolver**: The logic inside the generated `src/main.ts` that derives the CORS origin allowlist from the `CORS_ORIGINS` environment variable.
- **Example_Repository**: The generated `src/repositories/example.repository.ts` (`ExampleRepository`) that performs database queries for the example `items` resource.
- **Production_Mode**: The runtime condition where the `NODE_ENV` environment variable equals `production`.
- **Development_Mode**: The runtime condition where the `NODE_ENV` environment variable does not equal `production`.
- **ServiceUnavailableException**: The exception type exported from `streetjs` that the framework maps to an HTTP 503 response.
- **CORS_ORIGINS**: The environment variable holding a comma-separated allowlist of trusted origins for cross-origin requests.

## Requirements

### Requirement 1: Zero-config SQLite boot

**User Story:** As a developer running a freshly generated SQLite-backed project, I want the application to start without any database setup, so that I can begin development immediately.

#### Acceptance Criteria

1. WHEN the Generated_App starts with the SQLite driver and no database environment configuration is provided, THE Generated_App SHALL open a SQLite pool using the path from `SQLITE_PATH` or the default `:memory:` value.
2. WHEN the SQLite pool is opened, THE Generated_App SHALL create the `items` table if the `items` table does not already exist.
3. WHEN the `items` table has been ensured, THE Generated_App SHALL log the message `Database ready (sqlite).`.
4. WHERE the SQLite driver is selected, THE Generated_App SHALL complete startup without requiring any manually supplied database credentials.

### Requirement 2: Ephemeral development secrets with production fail-fast

**User Story:** As a developer, I want valid security keys to exist on first run without manual setup, while production refuses to start without explicit keys, so that local development is frictionless and production is never secured by throwaway keys.

#### Acceptance Criteria

1. WHERE the `JWT_SECRET` environment variable is set to a non-empty value, THE Secret_Resolver SHALL return the provided `JWT_SECRET` value unchanged.
2. WHERE the `SESSION_KEY` environment variable is set to a non-empty value, THE Secret_Resolver SHALL return the provided `SESSION_KEY` value unchanged.
3. IF the `JWT_SECRET` environment variable is unset or empty WHILE the Generated_App runs in Development_Mode, THEN THE Secret_Resolver SHALL generate a JWT secret of at least 32 characters at runtime.
4. IF the `SESSION_KEY` environment variable is unset or empty WHILE the Generated_App runs in Development_Mode, THEN THE Secret_Resolver SHALL generate a session key of exactly 64 hexadecimal characters at runtime.
5. WHEN the Secret_Resolver generates an ephemeral key in Development_Mode, THE Secret_Resolver SHALL emit a warning that the generated key is for development use only.
6. IF the `JWT_SECRET` or `SESSION_KEY` environment variable is unset or empty WHILE the Generated_App runs in Production_Mode, THEN THE Secret_Resolver SHALL throw a startup error that names the missing environment variable and SHALL halt startup.

### Requirement 3: Graceful PostgreSQL boot

**User Story:** As a developer running a PostgreSQL-backed project without database credentials, I want the server to still start with clear guidance, so that I can configure the database without fighting crashes.

#### Acceptance Criteria

1. IF the PostgreSQL driver is selected AND any of `PG_USER`, `PG_PASSWORD`, or `PG_DATABASE` is unset or empty, THEN THE Generated_App SHALL log guidance that names the missing variables and describes how to configure them, AND SHALL continue startup without opening a database connection.
2. IF a PostgreSQL connection attempt fails during startup, THEN THE Generated_App SHALL log guidance describing the failure and the credentials to check, AND SHALL continue serving requests without terminating the process.
3. WHILE the PostgreSQL database is unconfigured or unreachable, THE Generated_App SHALL continue to serve the health route and all routes that do not require the database.

### Requirement 4: HTTP 503 for unconfigured or unreachable database

**User Story:** As an API consumer, I want database-backed routes to return a clear 503 when the database is not available, so that I receive an actionable status instead of a crash or a generic 500.

#### Acceptance Criteria

1. WHEN a method of the Example_Repository is invoked AND the database pool cannot be resolved from the container, THE Example_Repository SHALL raise a ServiceUnavailableException.
2. WHEN the Example_Repository raises a ServiceUnavailableException, THE Generated_App SHALL respond to the originating request with HTTP status 503.
3. THE Example_Repository SHALL resolve the database pool lazily within each query method so that the Example_Repository can be constructed while the database is unconfigured.

### Requirement 5: Configurable CORS allowlist

**User Story:** As an operator deploying a generated app, I want CORS origins controlled by an environment allowlist with no wildcard in production, so that the API is not exposed to arbitrary origins by default.

#### Acceptance Criteria

1. WHERE the `CORS_ORIGINS` environment variable contains one or more comma-separated origins, THE CORS_Resolver SHALL produce an allowlist containing each trimmed, non-empty origin from `CORS_ORIGINS`.
2. WHEN the CORS_Resolver has produced the allowlist, THE Generated_App SHALL apply the CORS middleware using the produced allowlist as its set of permitted origins.
3. IF the `CORS_ORIGINS` environment variable is empty or unset WHILE the Generated_App runs in Development_Mode, THEN THE CORS_Resolver SHALL produce an allowlist permitting all origins (`*`) AND THE Generated_App SHALL emit a warning that all origins are permitted for development only.
4. IF the `CORS_ORIGINS` environment variable is empty or unset WHILE the Generated_App runs in Production_Mode, THEN THE CORS_Resolver SHALL throw a startup error indicating that `CORS_ORIGINS` is required AND SHALL halt startup.

### Requirement 6: CORS configuration discoverability

**User Story:** As a developer, I want `CORS_ORIGINS` documented in the generated configuration files, so that I can discover and set the allowlist before deploying.

#### Acceptance Criteria

1. WHEN the Project_Generator emits the `.env.example` file for the SQLite variant, THE Project_Generator SHALL include a `CORS_ORIGINS` entry with an explanatory comment.
2. WHEN the Project_Generator emits the `.env.example` file for the PostgreSQL variant, THE Project_Generator SHALL include a `CORS_ORIGINS` entry with an explanatory comment.
3. WHEN the Project_Generator emits the `docker-compose.yml` file for the SQLite variant, THE Project_Generator SHALL include `CORS_ORIGINS` in the application service environment block.
4. WHEN the Project_Generator emits the `docker-compose.yml` file for the PostgreSQL variant, THE Project_Generator SHALL include `CORS_ORIGINS` in the application service environment block.

### Requirement 7: Unauthenticated example routes notice

**User Story:** As a developer reading the generated entry point, I want an explicit notice that the example routes are unauthenticated, so that I protect them before exposing the service publicly.

#### Acceptance Criteria

1. WHEN the Project_Generator emits the `src/main.ts` file, THE Project_Generator SHALL include a comment stating that the example routes are unauthenticated and must be protected before public exposure.
