// src/tests/enterprise-console-openapi.test.ts
// Unit tests for the Enterprise Console OpenAPI generation (Task 10.4, Req 6.9).
// Verifies the generated spec is well-formed and covers every exposed operation.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { consoleOpenApiSpec, CONSOLE_ROUTES } from '../enterprise/console/index.js';
import { openApiOperations } from '../security/dast.js';

type Spec = {
  openapi: string;
  info: { title: string; version: string; description?: string };
  paths: Record<string, Record<string, Record<string, unknown>>>;
  tags?: Array<{ name: string }>;
  security?: unknown;
};

function toOpenApiPath(pattern: string): string {
  return pattern.replace(/:([a-zA-Z_][a-zA-Z0-9_]*)/g, '{$1}');
}

describe('consoleOpenApiSpec — structure', () => {
  it('produces an OpenAPI 3.1 document with console identity', () => {
    const spec = consoleOpenApiSpec() as Spec;
    assert.equal(spec.openapi, '3.1.0');
    assert.equal(spec.info.title, 'Street Enterprise Console API');
    assert.ok(spec.info.version.length > 0);
    assert.ok(Array.isArray(spec.tags) && spec.tags.length === 4);
  });

  it('covers every exposed console operation (Req 6.9)', () => {
    const spec = consoleOpenApiSpec() as Spec;
    const ops = new Set(openApiOperations(spec).map((o) => `${o.method} ${o.path}`));
    for (const route of CONSOLE_ROUTES) {
      const key = `${route.method.toUpperCase()} ${toOpenApiPath(route.pattern)}`;
      assert.ok(ops.has(key), `missing operation: ${key}`);
    }
    // No more operations than routes (1:1 coverage).
    assert.equal(ops.size, CONSOLE_ROUTES.length);
  });

  it('gives each operation an operationId, security, and standard error responses', () => {
    const spec = consoleOpenApiSpec() as Spec;
    for (const route of CONSOLE_ROUTES) {
      const op = spec.paths[toOpenApiPath(route.pattern)]?.[route.method.toLowerCase()];
      assert.ok(op, `no operation node for ${route.operationId}`);
      assert.equal(op['operationId'], route.operationId);
      assert.deepEqual(op['security'], [{ bearerAuth: [] }]);
      const responses = op['responses'] as Record<string, unknown>;
      assert.ok(responses['400'] && responses['401'] && responses['403']);
    }
  });

  it('documents a request body for body-carrying operations', () => {
    const spec = consoleOpenApiSpec() as Spec;
    const createTenant = spec.paths['/api/admin/tenants']?.['post'];
    assert.ok(createTenant?.['requestBody'], 'createTenant should document a request body');
    // A read operation takes no body.
    const report = spec.paths['/api/admin/compliance/report']?.['get'];
    assert.equal(report?.['requestBody'], undefined);
  });
});
