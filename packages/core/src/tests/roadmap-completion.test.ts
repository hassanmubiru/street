// tests/roadmap-completion.test.ts
// Unit tests for the v1.6–v3.0 roadmap modules that are testable in-process
// without external infrastructure. Uses only node:test + node:assert.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// ── Versioning ────────────────────────────────────────────────────────────────

import { ApiVersion, getApiVersion, Deprecated, getDeprecatedMeta } from '../versioning/strategy.js';

describe('API Versioning decorators', () => {
  it('@ApiVersion stores version metadata on the controller', () => {
    @ApiVersion('v2')
    class CtrlV2 {}
    assert.equal(getApiVersion(CtrlV2), 'v2');
  });

  it('@Deprecated stores sunset metadata and injects response headers', async () => {
    const sunset = new Date('2030-01-01T00:00:00Z');
    class Ctrl {
      @Deprecated({ sunset })
      async handler(ctx: { setHeader(n: string, v: string): void }): Promise<string> {
        return 'ok';
      }
    }
    const meta = getDeprecatedMeta(Ctrl.prototype, 'handler');
    assert.ok(meta);
    assert.equal(meta!.sunset?.getTime(), sunset.getTime());

    const headers: Record<string, string> = {};
    const ctx = { setHeader: (n: string, v: string) => { headers[n] = v; } };
    const result = await new Ctrl().handler(ctx);
    assert.equal(result, 'ok');
    assert.equal(headers['Deprecation'], 'true');
    assert.equal(headers['Sunset'], sunset.toUTCString());
  });
});

// ── SDK Generator ─────────────────────────────────────────────────────────────

import { generateTypescriptSdk, type OpenApiSpec } from '../sdk-gen/typescript.js';
import { generatePythonSdk } from '../sdk-gen/python.js';

describe('SDK Generator', () => {
  let dir: string;
  const spec: OpenApiSpec = {
    paths: {
      '/users/{id}': {
        get: { operationId: 'getUser', summary: 'Fetch a user', parameters: [{ name: 'id', in: 'path', required: true }] },
      },
      '/users': {
        post: { operationId: 'createUser', summary: 'Create a user' },
      },
    },
  };

  before(async () => { dir = await mkdtemp(join(tmpdir(), 'street-sdk-')); });
  after(async () => { await rm(dir, { recursive: true, force: true }); });

  it('generates a TypeScript SDK with types and client', async () => {
    await generateTypescriptSdk(spec, dir);
    const types = await readFile(join(dir, 'types.ts'), 'utf8');
    const client = await readFile(join(dir, 'api-client.ts'), 'utf8');
    assert.match(types, /GetUserParams/);
    assert.match(client, /class ApiClient/);
    assert.match(client, /getUser/);
    assert.match(client, /createUser/);
  });

  it('generates a Python SDK with models and client', async () => {
    await generatePythonSdk(spec, dir);
    const models = await readFile(join(dir, 'models.py'), 'utf8');
    const client = await readFile(join(dir, 'client.py'), 'utf8');
    assert.match(models, /class GetUserParams/);
    assert.match(client, /class ApiClient/);
    assert.match(client, /def get_user/);
  });
});
