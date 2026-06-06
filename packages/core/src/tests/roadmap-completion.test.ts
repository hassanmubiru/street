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
