# Contributing to street

Thank you for your interest in contributing. This document explains how to set up the development environment, run tests, and submit pull requests.

---

## Development setup

```bash
git clone https://github.com/your-org/street.git
cd street
npm install
```

Start a local PostgreSQL instance:

```bash
docker run -d \
  --name street-dev-db \
  -e POSTGRES_DB=street_dev \
  -e POSTGRES_USER=street \
  -e POSTGRES_PASSWORD=street \
  -p 5432:5432 \
  postgres:16-alpine
```

Copy and configure environment:

```bash
cp .env.example .env
# Fill in values — PG_HOST=localhost is already correct for the Docker setup above
```

Build and verify:

```bash
npm run build
npm test
```

---

## Code standards

- **TypeScript strict mode** — all `strict`, `noImplicitAny`, `noUnusedLocals` flags must pass
- **No new runtime dependencies** — street's dependency count (2) is intentional
- **Memory bounds required** — every new collection, queue, or cache must have an explicit upper bound
- **No `any` casts** — use typed generics or unknown with type guards
- **`.js` extensions on imports** — NodeNext ESM requires explicit extensions in source

Run the type-checker before committing:

```bash
npx tsc --noEmit
```

---

## Testing

All new features must include integration tests in `tests/integration.test.ts` using only `node:test` and `node:assert`.

Tests must:
- Connect to a real PostgreSQL instance
- Clean up all created data in `after()` hooks
- Close all connections and servers explicitly
- Not use `setTimeout` for timing-dependent assertions (use proper async/await)

Run tests:

```bash
PG_HOST=localhost PG_USER=street PG_PASSWORD=street PG_DATABASE=street_dev \
  JWT_SECRET="test-secret-at-least-32-chars-here!!" \
  SESSION_KEY=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))") \
  node --test dist/tests/integration.test.js
```

---

## Pull request checklist

- [ ] `npx tsc --noEmit` passes with zero errors
- [ ] All existing tests pass
- [ ] New tests added for new functionality
- [ ] `CHANGELOG.md` updated under `[Unreleased]`
- [ ] No new runtime dependencies introduced
- [ ] Memory bounds documented for any new data structures
- [ ] Public API additions exported from `src/index.ts`

---

## Commit message format

```
type(scope): short description

Longer explanation if needed.

Fixes #123
```

Types: `feat`, `fix`, `docs`, `refactor`, `test`, `chore`, `perf`

Examples:
```
feat(database): add SCRAM-SHA-256 authentication support
fix(pool): prevent acquire queue memory leak on pool close
docs(websocket): add heartbeat configuration example
perf(lru): switch eviction to O(1) doubly-linked list
```

---

## Releasing (maintainers only)

Patch release:

```bash
npm run version:patch          # bumps 1.0.0 → 1.0.1
git add package.json CHANGELOG.md
git commit -m "chore: release v1.0.1"
git tag v1.0.1
git push origin main --tags    # triggers npm-publish workflow
```
