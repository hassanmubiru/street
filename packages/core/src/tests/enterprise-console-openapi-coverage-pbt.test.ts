// tests/enterprise-console-openapi-coverage-pbt.test.ts
// Property-based test for Enterprise Console OpenAPI coverage (Req 6.9).
// Kept in its own file so the universal coverage property is exercised across
// many subsets/permutations of the console route table without clobbering the
// example/edge-case unit tests in enterprise-console-openapi.test.ts.
//
// Requirement 6.9 states the Enterprise Console API SHALL have a generated
// OpenAPI specification that (together with published docs) covers every
// exposed operation. This file proves, across arbitrary subsets and
// permutations of CONSOLE_ROUTES, that `consoleOpenApiSpec(routes)` generates a
// spec whose enumerated operation set (via `openApiOperations`) equals EXACTLY
// the route set — every route is present, none is omitted, and no extra
// operation is invented (1:1 coverage).

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';

import { consoleOpenApiSpec, CONSOLE_ROUTES } from '../enterprise/console/index.js';
import { openApiOperations } from '../security/dast.js';
import type { ConsoleRoute } from '../enterprise/console/types.js';

const NUM_RUNS = 100;

// ── Oracle ──────────────────────────────────────────────────────────────────
//
// The documented coverage contract expressed independently of the generator:
// a route's exposed operation is its uppercase HTTP method paired with the
// OpenAPI form of its path pattern (`:name` segments become `{name}`).
function toOpenApiPath(pattern: string): string {
  return pattern.replace(/:([a-zA-Z_][a-zA-Z0-9_]*)/g, '{$1}');
}

/** Stable, comparable key for an operation / route. */
const routeKey = (r: ConsoleRoute): string => `${r.method.toUpperCase()} ${toOpenApiPath(r.pattern)}`;
const opKey = (o: { method: string; path: string }): string => `${o.method.toUpperCase()} ${o.path}`;

// Sanity: the full route table has no two routes sharing a (method, path).
// If this ever broke, exact 1:1 coverage would be impossible to assert.
{
  const all = CONSOLE_ROUTES.map(routeKey);
  assert.equal(all.length, new Set(all).size, 'CONSOLE_ROUTES has duplicate (method, path) operations');
}

// ── Generator ─────────────────────────────────────────────────────────────────
//
// A non-empty subset of CONSOLE_ROUTES in an arbitrary order. `subarray`
// preserves no required ordering and `shuffledSubarray` additionally permutes,
// so the property spans subsets AND permutations of the route table. The
// generated subset never contains duplicate routes, so a clean 1:1 mapping is
// always expected.
const routesArb: fc.Arbitrary<ConsoleRoute[]> = fc
  .shuffledSubarray(CONSOLE_ROUTES, { minLength: 1, maxLength: CONSOLE_ROUTES.length });

// Feature: platform-leadership-gaps, Property 16: Generated OpenAPI covers every exposed enterprise operation
// Validates: Requirements 6.9
describe('Property 16: generated OpenAPI covers every exposed enterprise operation', () => {
  it('the generated spec enumerates exactly the route set — none omitted, none extra', () => {
    fc.assert(
      fc.property(routesArb, (routes) => {
        const spec = consoleOpenApiSpec(routes);
        const operationKeys = openApiOperations(spec).map(opKey).sort();
        const routeKeys = routes.map(routeKey).sort();

        // Same multiset of operations: every exposed route operation appears in
        // the spec and nothing extra is invented or duplicated.
        assert.deepEqual(operationKeys, routeKeys);

        // Restated as set containment for clarity: every route is covered…
        const opSet = new Set(operationKeys);
        for (const r of routes) {
          assert.ok(opSet.has(routeKey(r)), `missing operation for route: ${routeKey(r)}`);
        }
        // …and every enumerated operation traces back to a supplied route.
        const routeSet = new Set(routeKeys);
        for (const k of operationKeys) {
          assert.ok(routeSet.has(k), `spec exposed an operation with no route: ${k}`);
        }

        // 1:1 coverage: distinct operation count equals distinct route count.
        assert.equal(opSet.size, routeSet.size);
        assert.equal(opSet.size, routes.length);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('the default full surface covers every exposed operation 1:1', () => {
    const spec = consoleOpenApiSpec();
    const operationKeys = openApiOperations(spec).map(opKey).sort();
    const routeKeys = CONSOLE_ROUTES.map(routeKey).sort();
    assert.deepEqual(operationKeys, routeKeys);
  });
});
