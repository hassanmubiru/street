import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';

import {
  PluginHost,
  type PluginManifest,
} from '../src/platform/plugins/host.js';
import { PluginModule } from '../src/platform/plugins/sdk.js';

// Feature: security-hardening, Property 5: The registered manifest is immutable across the lifecycle
//
// For any valid manifest, after registration the host's stored manifest SHALL be a
// deep-frozen copy distinct from the caller's reference, such that any mutation
// applied to the original manifest object after registration leaves the host's
// permission and dependency decisions and the value returned by `manifestOf`
// unchanged.
//
// Validates: Requirements 6.1, 6.2, 6.3, 6.4

// ---- recognized permission values (independent of the module-private tuple) ----

const PERMISSION_VALUES = ['middleware', 'events', 'net', 'fs', 'db', 'secrets'] as const;

// ---- helpers ----------------------------------------------------------------

/** Minimal plugin whose name/version match the manifest (cast around the abstract base). */
function makePlugin(name: string, version: string): PluginModule {
  return { name, version } as unknown as PluginModule;
}

// ---- generators -------------------------------------------------------------

// Permissions are a subarray of the recognized values; with a '*' host every one
// is granted, so a clean (un-mutated) manifest is always enable-able.
const permissionsArb = fc.subarray([...PERMISSION_VALUES]);

// Dependency names are namespaced ('dep_...') and unique so they never collide
// with the main plugin name ('main_...') or with each other. Range '*' is always
// satisfied, so the stubs we register below let enable() resolve them.
const depNamesArb = fc.uniqueArray(
  fc.string({ minLength: 1, maxLength: 6 }).map((s) => `dep_${s}`),
  { maxLength: 4 },
);

const versionArb = fc
  .tuple(fc.nat(9), fc.nat(9), fc.nat(9))
  .map(([a, b, c]) => `${a}.${b}.${c}`);

interface GeneratedManifest {
  nameSuffix: string;
  version: string;
  capabilities: string[];
  permissions: string[];
  depNames: string[];
}

const manifestArb: fc.Arbitrary<GeneratedManifest> = fc.record({
  nameSuffix: fc.string({ minLength: 1, maxLength: 8 }),
  version: versionArb,
  capabilities: fc.array(fc.string(), { maxLength: 3 }),
  permissions: permissionsArb,
  depNames: depNamesArb,
});

// A single random post-register mutation applied to the ORIGINAL manifest object.
const mutationArb = fc.record({
  kind: fc.integer({ min: 0, max: 4 }),
  extra: fc.string({ minLength: 1, maxLength: 6 }),
});

/** Mutate the caller's original manifest in place (must be inert to the host). */
function mutateOriginal(original: PluginManifest, m: { kind: number; extra: string }): void {
  const perms = original.permissions as unknown as string[];
  const deps = original.dependencies as Record<string, string>;
  switch (m.kind) {
    case 0:
      // Add an UNGRANTED permission: if this leaked into the frozen copy, enable()
      // would throw PluginPermissionError.
      perms.push('admin');
      break;
    case 1:
      original.version = `${original.version}-${m.extra}`;
      break;
    case 2:
      // Add a dependency on a plugin that was never registered.
      deps[`missing_${m.extra}`] = '^9.9.9';
      break;
    case 3: {
      const keys = Object.keys(deps);
      if (keys.length > 0) delete deps[keys[0]!];
      else perms.push('admin');
      break;
    }
    case 4:
      original.name = `hacked_${m.extra}`;
      break;
    default:
      break;
  }
}

// ---- property ---------------------------------------------------------------

describe('Property 5: the registered manifest is immutable across the lifecycle', () => {
  it('stores a frozen, distinct copy that post-register mutation cannot affect', async () => {
    await fc.assert(
      fc.asyncProperty(manifestArb, mutationArb, async (gen, mutation) => {
        // '*' grants every recognized permission, so a clean manifest enables.
        const host = new PluginHost({ grantedPermissions: '*' });

        const name = `main_${gen.nameSuffix}`;

        // Register a stub for every dependency so the clean frozen copy resolves.
        for (const dep of gen.depNames) {
          host.register(makePlugin(dep, '1.0.0'), { name: dep, version: '1.0.0' });
        }

        const dependencies: Record<string, string> = {};
        for (const dep of gen.depNames) dependencies[dep] = '*';

        const originalManifest: PluginManifest = {
          name,
          version: gen.version,
          capabilities: [...gen.capabilities],
          permissions: [...gen.permissions] as PluginManifest['permissions'],
          dependencies,
        };

        host.register(makePlugin(name, gen.version), originalManifest);

        const stored = host.manifestOf(name);
        assert.ok(stored, 'manifest should be registered');

        // (Req 6.1 / 6.4) The stored manifest is a DISTINCT object from the caller's.
        assert.notEqual(stored, originalManifest, 'stored manifest must not be the caller reference');

        // (Req 6.1) Deep-frozen: top level and nested arrays/objects.
        assert.equal(Object.isFrozen(stored), true, 'stored manifest must be frozen');
        assert.equal(Object.isFrozen(stored!.permissions), true, 'permissions must be frozen');
        assert.equal(Object.isFrozen(stored!.dependencies), true, 'dependencies must be frozen');
        assert.equal(Object.isFrozen(stored!.capabilities), true, 'capabilities must be frozen');

        // Snapshot the stored copy immediately after registration.
        const snapshot = structuredClone(stored);

        // (Req 6.3) Mutate the ORIGINAL after registration...
        mutateOriginal(originalManifest, mutation);

        // ...the stored copy is unchanged.
        assert.deepEqual(host.manifestOf(name), snapshot, 'manifestOf must be unaffected by mutation');

        // (Req 6.2) Lifecycle decisions read the frozen copy: enable() still succeeds
        // even though the original now carries an ungranted permission / missing dep.
        await host.enable(name);
        assert.equal(host.state(name), 'enabled', 'enable() should succeed from the frozen copy');

        // And the stored copy remains unchanged after enable.
        assert.deepEqual(host.manifestOf(name), snapshot, 'manifestOf must remain unchanged after enable');
      }),
      { numRuns: 100 },
    );
  });
});
