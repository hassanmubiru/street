// tests/validation.test.ts
// Example / edge-case unit tests for the runtime input Validator (Phase 1,
// Requirement 2). Complements the property-based suites
// (validation-determinism-pbt.test.ts, validation-rejection-pbt.test.ts) with
// concrete examples covering:
//   • Per-source acceptance for every External_Input source — body, query,
//     params, headers, cookies (R2.1).
//   • Startup happy paths for validateEnv / validateArgv that parse conforming
//     input and return typed values without terminating the process (R2.7).
//   • Schema-inferred handler parameter types via validated() (R2.6), enforced
//     both at runtime and by the type checker at build time.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';

import {
  validate,
  validated,
  validateEnv,
  validateArgv,
  type RouteSchemas,
} from '../security/validation.js';
import type { StreetContext } from '../core/context.js';

// ── A minimal StreetContext stand-in ─────────────────────────────────────────
//
// validate() only reads the per-source raw inputs (ctx.body / query / params /
// headers, with cookies parsed from the `cookie` header) and writes parsed
// values to ctx.state.valid. A small object carrying exactly those fields is a
// faithful substrate for these examples and avoids a real HTTP server.
interface CtxParts {
  body?: unknown;
  query?: Record<string, string>;
  params?: Record<string, string>;
  headers?: Record<string, string>;
}

function makeCtx(parts: CtxParts): StreetContext {
  return {
    body: parts.body ?? null,
    query: { ...(parts.query ?? {}) },
    params: { ...(parts.params ?? {}) },
    headers: { ...(parts.headers ?? {}) },
    state: {},
  } as unknown as StreetContext;
}

/** Run validate() over a ctx and report whether the handler ran + the valid state. */
async function runValidate(
  schemas: RouteSchemas,
  ctx: StreetContext,
): Promise<{ handlerRan: boolean; valid: Record<string, unknown> | undefined }> {
  let handlerRan = false;
  await validate(schemas)(ctx, async () => {
    handlerRan = true;
  });
  const valid = (ctx.state as Record<string, unknown> | undefined)?.['valid'] as
    | Record<string, unknown>
    | undefined;
  return { handlerRan, valid };
}

// ── Per-source acceptance (R2.1) ─────────────────────────────────────────────

describe('validate(): per-source acceptance (R2.1)', () => {
  it('accepts and parses a conforming body', async () => {
    const schemas: RouteSchemas = {
      body: z.object({ name: z.string(), age: z.number().int() }),
    };
    const ctx = makeCtx({ body: { name: 'ada', age: 36 } });
    const { handlerRan, valid } = await runValidate(schemas, ctx);

    assert.equal(handlerRan, true);
    assert.deepEqual(valid?.['body'], { name: 'ada', age: 36 });
  });

  it('accepts and parses a conforming query', async () => {
    const schemas: RouteSchemas = { query: z.object({ page: z.string() }) };
    const ctx = makeCtx({ query: { page: '2' } });
    const { handlerRan, valid } = await runValidate(schemas, ctx);

    assert.equal(handlerRan, true);
    assert.deepEqual(valid?.['query'], { page: '2' });
  });

  it('accepts and parses conforming route params', async () => {
    const schemas: RouteSchemas = { params: z.object({ id: z.string() }) };
    const ctx = makeCtx({ params: { id: 'u_123' } });
    const { handlerRan, valid } = await runValidate(schemas, ctx);

    assert.equal(handlerRan, true);
    assert.deepEqual(valid?.['params'], { id: 'u_123' });
  });

  it('accepts and parses conforming headers', async () => {
    // z.object strips unknown keys, so only the declared header is surfaced.
    const schemas: RouteSchemas = { headers: z.object({ 'x-api-version': z.string() }) };
    const ctx = makeCtx({ headers: { 'x-api-version': '2024-01', 'user-agent': 'test' } });
    const { handlerRan, valid } = await runValidate(schemas, ctx);

    assert.equal(handlerRan, true);
    assert.deepEqual(valid?.['headers'], { 'x-api-version': '2024-01' });
  });

  it('accepts and parses cookies parsed from the Cookie header', async () => {
    const schemas: RouteSchemas = { cookies: z.object({ sid: z.string(), theme: z.string() }) };
    const ctx = makeCtx({ headers: { cookie: 'sid=abc123; theme=dark' } });
    const { handlerRan, valid } = await runValidate(schemas, ctx);

    assert.equal(handlerRan, true);
    assert.deepEqual(valid?.['cookies'], { sid: 'abc123', theme: 'dark' });
  });

  it('validates every source independently in a single declaration (R2.1)', async () => {
    const schemas: RouteSchemas = {
      body: z.object({ msg: z.string() }),
      query: z.object({ q: z.string() }),
      params: z.object({ id: z.string() }),
      headers: z.object({ 'x-trace': z.string() }),
      cookies: z.object({ sid: z.string() }),
    };
    const ctx = makeCtx({
      body: { msg: 'hi' },
      query: { q: 'search' },
      params: { id: '7' },
      headers: { 'x-trace': 't-1', cookie: 'sid=s-1' },
    });
    const { handlerRan, valid } = await runValidate(schemas, ctx);

    assert.equal(handlerRan, true);
    assert.deepEqual(valid?.['body'], { msg: 'hi' });
    assert.deepEqual(valid?.['query'], { q: 'search' });
    assert.deepEqual(valid?.['params'], { id: '7' });
    assert.deepEqual(valid?.['headers'], { 'x-trace': 't-1' });
    assert.deepEqual(valid?.['cookies'], { sid: 's-1' });
  });

  it('applies schema coercion/transform so the handler sees the parsed value', async () => {
    // A coercing schema proves the handler receives the PARSED value (R2.2),
    // not the raw string from the query record.
    const schemas: RouteSchemas = { query: z.object({ page: z.coerce.number().int() }) };
    const ctx = makeCtx({ query: { page: '42' } });
    const { valid } = await runValidate(schemas, ctx);

    assert.deepEqual(valid?.['query'], { page: 42 });
  });
});

// ── Startup happy path (R2.7) ────────────────────────────────────────────────

describe('validateEnv(): startup happy path (R2.7)', () => {
  it('returns typed, parsed values for conforming env vars without exiting', () => {
    const schema = z.object({
      PORT: z.coerce.number().int(),
      NODE_ENV: z.enum(['development', 'production', 'test']),
      DEBUG: z
        .string()
        .optional()
        .transform((v) => v === 'true'),
    });
    const parsed = validateEnv(schema, {
      PORT: '8080',
      NODE_ENV: 'production',
      DEBUG: 'true',
    } as unknown as NodeJS.ProcessEnv);

    assert.equal(parsed.PORT, 8080);
    assert.equal(parsed.NODE_ENV, 'production');
    assert.equal(parsed.DEBUG, true);
  });

  it('passes through extra env vars while validating declared ones', () => {
    const schema = z.object({ API_KEY: z.string().min(1) });
    const parsed = validateEnv(schema, {
      API_KEY: 'k-123',
      UNRELATED: 'ignored',
    } as unknown as NodeJS.ProcessEnv);

    assert.equal(parsed.API_KEY, 'k-123');
  });
});

describe('validateArgv(): startup happy path (R2.7)', () => {
  it('parses --flag=value, --flag value, and boolean flags', () => {
    const schema = z.object({
      host: z.string(),
      port: z.coerce.number().int(),
      verbose: z.coerce.boolean(),
    });
    const parsed = validateArgv(schema, ['--host=localhost', '--port', '3000', '--verbose']);

    assert.equal(parsed.host, 'localhost');
    assert.equal(parsed.port, 3000);
    assert.equal(parsed.verbose, true);
  });

  it('collects repeated flags into an array', () => {
    const schema = z.object({ tag: z.array(z.string()) });
    const parsed = validateArgv(schema, ['--tag', 'a', '--tag', 'b']);

    assert.deepEqual(parsed.tag, ['a', 'b']);
  });
});

// ── Schema-inferred handler parameter types (R2.6) ───────────────────────────

describe('validated(): schema-inferred handler parameter types (R2.6)', () => {
  it('returns values whose static types are inferred from the schemas', async () => {
    const schemas = {
      body: z.object({ title: z.string(), count: z.number().int() }),
      params: z.object({ id: z.string() }),
    } satisfies RouteSchemas;

    const ctx = makeCtx({
      body: { title: 'hello', count: 3 },
      params: { id: 'x-1' },
    });
    await runValidate(schemas, ctx);

    const v = validated(ctx, schemas);

    // Type-level assertions: these assignments only compile if validated()
    // inferred body/params types from the Zod schemas (R2.6). A build-time
    // failure here would fail the suite via `tsc`.
    const title: string = v.body.title;
    const count: number = v.body.count;
    const id: string = v.params.id;

    assert.equal(title, 'hello');
    assert.equal(count, 3);
    assert.equal(id, 'x-1');
  });

  it('only exposes the declared sources through the typed accessor', async () => {
    const schemas = { query: z.object({ term: z.string() }) } satisfies RouteSchemas;
    const ctx = makeCtx({ query: { term: 'street' } });
    await runValidate(schemas, ctx);

    const v = validated(ctx, schemas);
    const term: string = v.query.term;

    assert.equal(term, 'street');
    assert.deepEqual(Object.keys(v), ['query']);
  });
});
