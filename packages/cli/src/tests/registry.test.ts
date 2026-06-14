// packages/cli/src/tests/registry.test.ts
// Unit tests for `street registry publish|install|search|list`.
//
// These drive a REAL @streetjs/registry-server instance started in-process so
// the CLI is exercised against the actual `/api/v1` REST contract (Req 4.1):
// publish (authn + authz + Ed25519 verification), download (byte-faithful round
// trip with consumer-side integrity validation, Req 4.3), search, and list.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { generateKeyPairSync } from 'node:crypto';

import { RegistryCommand } from '../commands/registry.js';
import type { CliContext } from '../index.js';

// The real registry server lives in a sibling package. We import its compiled
// output by relative path at RUNTIME only — the CLI must not have a build-time
// dependency on it (it may not be built yet, e.g. when the CLI is built first
// in the publish job). A minimal structural type avoids `typeof import(...)`,
// and the dynamic import below uses a string-typed specifier so tsc does not
// resolve the path at compile time.
interface RegistryServerModule {
  PublisherDirectory: new () => { register(id: string, apiKey: string, namespaces: string[]): void };
  RegistryService: new (opts: { publishers: unknown }) => unknown;
  startRegistryServer: (
    service: unknown,
    port: number,
    host: string,
  ) => Promise<{ server: import('node:http').Server; close: () => Promise<void> }>;
}

// String-typed so tsc treats it as an opaque module specifier (no path resolution).
const REGISTRY_SERVER_MODULE: string = '../../../registry-server/dist/index.js';

interface Captured {
  logs: string[];
  errors: string[];
}

function captureConsole(): { output: Captured; restore: () => void } {
  const output: Captured = { logs: [], errors: [] };
  const origLog = console.log;
  const origErr = console.error;
  console.log = (...args: unknown[]) => { output.logs.push(args.map(String).join(' ')); };
  console.error = (...args: unknown[]) => { output.errors.push(args.map(String).join(' ')); };
  return { output, restore: () => { console.log = origLog; console.error = origErr; } };
}

function ctx(cwd: string, positional: string[], flags: Record<string, string | boolean>): CliContext {
  return { cwd, args: { command: 'registry', positional, flags } };
}

const API_KEY = 'test-secret-token';
const NAMESPACE = 'acme';
const PLUGIN_NAME = 'acme/widget';

void describe('RegistryCommand', () => {
  let server: { server: import('node:http').Server; close: () => Promise<void> } | undefined;
  let baseUrl = '';
  let tmpDir: string;
  let manifestPath: string;
  let tarballPath: string;
  let keyPath: string;
  let serverAvailable = false;

  before(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'street-registry-test-'));

    // Publisher Ed25519 keypair. The private key signs the manifest; the public
    // key is derived by the CLI and sent for server-side verification.
    const { privateKey } = generateKeyPairSync('ed25519');
    keyPath = join(tmpDir, 'publisher.key.pem');
    writeFileSync(keyPath, privateKey.export({ type: 'pkcs8', format: 'pem' }).toString());

    // A well-formed manifest (unsigned — the CLI signs it at publish time).
    manifestPath = join(tmpDir, 'manifest.json');
    writeFileSync(
      manifestPath,
      JSON.stringify({ name: PLUGIN_NAME, version: '1.2.0', capabilities: ['widgets'] }),
    );

    // The plugin tarball (opaque bytes for this test).
    tarballPath = join(tmpDir, 'plugin.tgz');
    writeFileSync(tarballPath, Buffer.from('fake-tarball-contents-1234567890'));

    // Start the real registry server, seeded with a publisher that owns `acme`.
    try {
      const mod = (await import('../../../registry-server/dist/index.js')) as RegistryServerModule;
      const publishers = new mod.PublisherDirectory();
      publishers.register('acme-co', API_KEY, [NAMESPACE]);
      const service = new mod.RegistryService({ publishers });
      const handle = await mod.startRegistryServer(service, 0, '127.0.0.1');
      const addr = handle.server.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      baseUrl = `http://127.0.0.1:${port}`;
      server = handle;
      serverAvailable = true;
    } catch (err) {
      // The registry-server package isn't built; the server-dependent tests
      // will be skipped (build it with `npm run build -w packages/registry-server`).
      console.error(`registry-server not available: ${err instanceof Error ? err.message : String(err)}`);
      serverAvailable = false;
    }
  });

  after(async () => {
    if (server) await server.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  void it('prints usage and fails for an unknown subcommand', async () => {
    process.exitCode = 0;
    const { output, restore } = captureConsole();
    try {
      await new RegistryCommand().execute(ctx(tmpDir, ['bogus'], {}));
    } finally {
      restore();
    }
    assert.ok(output.errors.join('\n').includes('Usage'));
    assert.equal(process.exitCode, 1);
    process.exitCode = undefined;
  });

  void it('publish requires manifest, tarball, and key', async () => {
    process.exitCode = 0;
    const { output, restore } = captureConsole();
    try {
      await new RegistryCommand().execute(ctx(tmpDir, ['publish'], { token: API_KEY }));
    } finally {
      restore();
    }
    assert.ok(output.errors.join('\n').includes('--manifest'));
    assert.equal(process.exitCode, 1);
    process.exitCode = undefined;
  });

  void it('publish requires a bearer token', async () => {
    process.exitCode = 0;
    const { output, restore } = captureConsole();
    try {
      await new RegistryCommand().execute(
        ctx(tmpDir, ['publish'], { manifest: manifestPath, tarball: tarballPath, key: keyPath }),
      );
    } finally {
      restore();
    }
    assert.ok(output.errors.join('\n').toLowerCase().includes('bearer token'));
    assert.equal(process.exitCode, 1);
    process.exitCode = undefined;
  });

  void it('publishes, lists, searches, and installs with integrity verification', async (t) => {
    if (!serverAvailable) {
      t.skip('registry-server build not available');
      return;
    }
    process.exitCode = 0;

    // ── publish ──────────────────────────────────────────────────────────
    {
      const { output, restore } = captureConsole();
      try {
        await new RegistryCommand().execute(
          ctx(tmpDir, ['publish'], {
            registry: baseUrl,
            token: API_KEY,
            manifest: manifestPath,
            tarball: tarballPath,
            key: keyPath,
            categories: 'ui,tools',
            tags: 'widget',
            description: 'A widget plugin',
          }),
        );
      } finally {
        restore();
      }
      assert.equal(process.exitCode, 0, `publish errored: ${output.errors.join(' | ')}`);
      assert.ok(output.logs.join('\n').includes(`Published ${PLUGIN_NAME}@1.2.0`));
    }

    // ── list ──────────────────────────────────────────────────────────────
    {
      const { output, restore } = captureConsole();
      try {
        await new RegistryCommand().execute(ctx(tmpDir, ['list'], { registry: baseUrl }));
      } finally {
        restore();
      }
      assert.ok(output.logs.join('\n').includes(PLUGIN_NAME), 'list should include the published plugin');
    }

    // ── search ──────────────────────────────────────────────────────────
    {
      const { output, restore } = captureConsole();
      try {
        await new RegistryCommand().execute(ctx(tmpDir, ['search', 'widget'], { registry: baseUrl }));
      } finally {
        restore();
      }
      assert.ok(output.logs.join('\n').includes(PLUGIN_NAME), 'search should find the plugin by query');
    }

    // ── install (latest) ──────────────────────────────────────────────────
    {
      const outDir = join(tmpDir, 'installed');
      const { output, restore } = captureConsole();
      try {
        await new RegistryCommand().execute(
          ctx(tmpDir, ['install', PLUGIN_NAME], { registry: baseUrl, out: outDir }),
        );
      } finally {
        restore();
      }
      assert.equal(process.exitCode, 0, `install errored: ${output.errors.join(' | ')}`);
      assert.ok(output.logs.join('\n').includes('signature + checksum verified'));
      assert.ok(existsSync(join(outDir, 'manifest.json')), 'manifest.json should be written');
      assert.ok(existsSync(join(outDir, 'package.tgz')), 'tarball should be written');
      // The downloaded tarball must be byte-identical to what was published.
      assert.deepEqual(readFileSync(join(outDir, 'package.tgz')), readFileSync(tarballPath));
    }

    process.exitCode = undefined;
  });

  void it('rejects publishing under a namespace the token does not own', async (t) => {
    if (!serverAvailable) {
      t.skip('registry-server build not available');
      return;
    }
    process.exitCode = 0;
    const foreignManifest = join(tmpDir, 'foreign.json');
    writeFileSync(foreignManifest, JSON.stringify({ name: 'other/thing', version: '1.0.0' }));

    const { output, restore } = captureConsole();
    try {
      await new RegistryCommand().execute(
        ctx(tmpDir, ['publish'], {
          registry: baseUrl,
          token: API_KEY,
          manifest: foreignManifest,
          tarball: tarballPath,
          key: keyPath,
        }),
      );
    } finally {
      restore();
    }
    assert.equal(process.exitCode, 1);
    assert.ok(output.errors.join('\n').includes('UNAUTHORIZED'), 'should report an authorization rejection');
    process.exitCode = undefined;
  });

  void it('install fails for an unknown plugin', async (t) => {
    if (!serverAvailable) {
      t.skip('registry-server build not available');
      return;
    }
    process.exitCode = 0;
    const { output, restore } = captureConsole();
    try {
      await new RegistryCommand().execute(
        ctx(tmpDir, ['install', 'acme/missing@9.9.9'], { registry: baseUrl, out: join(tmpDir, 'nope') }),
      );
    } finally {
      restore();
    }
    assert.equal(process.exitCode, 1);
    assert.ok(output.errors.join('\n').includes('Install failed'));
    process.exitCode = undefined;
  });
});
