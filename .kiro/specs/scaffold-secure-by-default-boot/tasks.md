# Implementation Plan: Scaffold Secure-by-Default Boot

## Overview

All implementation edits are surgical changes to **template strings** emitted by the
`render*` methods in `packages/cli/src/commands/create.ts`. There are four actionable
gaps (R5.2, R7, R6.2, R6.3+R6.4); everything else is established contract that must not
regress. Tests follow the existing example-based generator pattern (scaffold to a temp
dir, read the emitted file, assert with `.includes`) and extend the existing CLI test
files. No new source files are introduced; no runtime-library code changes. Per the
design, property-based testing does not apply (deterministic template emission keyed on a
single discrete `database` parameter), so there are no property-test tasks.

## Tasks

- [ ] 1. Close the CORS and notice gaps in `renderMainTs`
  - [ ] 1.1 R5.2 — consume the computed CORS allowlist
    - In `renderMainTs`, change the emitted HTTP-server line from
      `app.use(corsMiddleware(['*']));` to `app.use(corsMiddleware(corsOrigins));`
    - This line is shared emitted text for both the `sqlite` and `postgres` variants, so
      the single edit covers both; no import changes (`corsMiddleware` already imported)
    - Do not alter the existing `corsOrigins` resolver logic (dev-empty push `'*'` + warn,
      prod-empty throw) — only wire its output into the middleware call
    - _Requirements: 5.2_

  - [ ] 1.2 R7 — emit the unauthenticated-example-routes notice
    - In `renderMainTs`, add an emitted comment immediately above the
      `registerController(HealthController)` / `registerController(ExampleController)`
      block stating the example routes are unauthenticated and must be protected before
      public exposure
    - Reference the already-wired primitives (`JwtService` / `SessionManager`) and the
      generated `src/middleware/auth.ts`; comment-only, no routing/behavioral change
    - This comment is shared emitted text, covering both variants in one edit
    - _Requirements: 7.1_

- [ ] 2. Close the discoverability gaps in the emitted config files
  - [ ] 2.1 R6.2 — add `CORS_ORIGINS` to the Postgres `.env.example`
    - In `renderEnvExample` (postgres branch), add a `CORS_ORIGINS` entry after
      `SESSION_KEY` using the same explanatory comment already present in the sqlite
      branch, with the value emitted empty (`CORS_ORIGINS=`)
    - Brings the postgres variant to parity with the already-satisfied sqlite variant
    - _Requirements: 6.2_

  - [ ] 2.2 R6.3 + R6.4 — add `CORS_ORIGINS` to both `docker-compose.yml` variants
    - In `renderDockerCompose`, add `CORS_ORIGINS` (emitted empty, with a one-line
      clarifying comment) to the `app` service `environment:` block in BOTH the sqlite and
      postgres branches
    - Both compose files set `NODE_ENV: development`, so an empty value is valid (yields
      the dev wildcard, not a prod fail-fast)
    - _Requirements: 6.3, 6.4_

- [ ] 3. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 4. Add gap-coverage and regression-lock assertions
  - [ ] 4.1 Add gap-coverage assertions for the four fixes
    - Extend the existing example-based generator tests (`create.test.ts` /
      `create-database.test.ts`) rather than creating new files
    - R5.2: generated `src/main.ts` contains `corsMiddleware(corsOrigins)` and does NOT
      contain `corsMiddleware(['*'])` — assert for both sqlite and postgres
    - R7: generated `src/main.ts` contains the unauthenticated-routes notice (match on
      "unauthenticated" / "protect" near the controller registration) — both variants
    - R6.2: generated postgres `.env.example` contains `CORS_ORIGINS`
    - R6.3 / R6.4: both docker-compose variants contain `CORS_ORIGINS` in the `app`
      service environment block
    - _Requirements: 5.2, 6.2, 6.3, 6.4, 7.1_

  - [ ] 4.2 Add regression-lock assertions for established contract
    - R1: sqlite `main.ts` contains `SqlitePool`, `CREATE TABLE IF NOT EXISTS items`, and
      the `Database ready (sqlite).` log
    - R2: `main.ts` contains `resolveSecret('JWT_SECRET', 24)` and
      `resolveSecret('SESSION_KEY', 32)`
    - R4: `example.repository.ts` contains the lazy `get pool()` getter and
      `ServiceUnavailableException`
    - R6.1: sqlite `.env.example` retains its `CORS_ORIGINS` entry + comment
    - Extend existing test files rather than creating new ones where practical
    - _Requirements: 1.1, 1.2, 1.3, 2.3, 2.4, 4.1, 4.3, 6.1_

- [ ] 5. Verification gate - build and full suite
  - Run `npm run build` then `npm test` in `packages/cli`
  - Require zero failures and zero skips (Rule 8); baseline is 102 + 50 passing and the
    new assertions add to that baseline without removing existing tests
  - Surface any breach (failure or skip) rather than papering over it
  - _Requirements: 1, 2, 4, 5.2, 6, 7_

## Notes

- Every implementation edit is confined to template strings in the four `render*` methods
  of `packages/cli/src/commands/create.ts`; the only new code is test assertions in the
  existing CLI test files.
- The shared `corsMiddleware` call line and the R7 comment are emitted identically for the
  sqlite and postgres variants, so each is a single edit that covers both.
- Property-based testing is intentionally omitted (deterministic template emission, single
  discrete parameter) — see the design's Testing Strategy.
- Each task references specific requirement clauses for traceability.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2"] },
    { "id": 2, "tasks": ["2.1"] },
    { "id": 3, "tasks": ["2.2"] },
    { "id": 4, "tasks": ["4.1"] },
    { "id": 5, "tasks": ["4.2"] }
  ]
}
```
