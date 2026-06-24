import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';

import {
  PluginHost,
  PluginManifestError,
  pluginManifestSchema,
  type PluginManifest,
} from '../src/platform/plugins/host.js';
import { PluginModule } from '../src/platform/plugins/sdk.js';

// Feature: security-hardening, Property 4: Registration succeeds iff the manifest satisfies the schema
//
// For any generated manifest, `PluginHost.register` SHALL pass the schema gate if
// and only if the manifest conforms to `pluginManifestSchema` (string name/version;
// permissions, when present, drawn only from the recognized permission values;
// dependencies, when present, mapping names to string version ranges). A
// non-conforming manifest SHALL be rejected with a `PluginManifestError` and SHALL
// NOT be registered.
//
// Validates: Requirements 5.1, 5.2, 5.4, 5.5

// ---- recognized permission values (independent of the module-private tuple) ----

const PERMISSION_VALUES = ['middleware', 'events', 'net', 'fs', 'db', 'secrets'] as const;

// ---- helpers ----------------------------------------------------------------

/**
 * Build a `PluginModule` whose `name`/`version` MATCH the manifest's so the
 * name/version-identity check (which runs AFTER the schema gate) never confounds
 * the schema-gate assertion. For invalid manifests the fields may be missing or
 * non-string; that is irrelevant because the schema gate rejects first.
 */
function makePlugin(manifest: Record<string, unknown>): PluginModule {
  return { name: manifest.name, version: manifest.version } as unknown as PluginModule;
}

// ---- generators -------------------------------------------------------------

// Non-empty strings for name/version and dependency names/ranges.
const nonEmptyStringArb = fc.string({ minLength: 1, maxLength: 12 });

// A schema-conforming manifest: non-empty name/version, permissions drawn only
// from the recognized values, dependencies mapping strings to string ranges.
const validManifestArb: fc.Arbitrary<Record<string, unknown>> = fc.record(
  {
    name: nonEmptyStringArb,
    version: nonEmptyStringArb,
    capabilities: fc.array(fc.string(), { maxLength: 4 }),
    permissions: fc.subarray([...PERMISSION_VALUES]),
    dependencies: fc.dictionary(nonEmptyStringArb, fc.string(), { maxKeys: 4 }),
    checksum: fc.string(),
    signature: fc.string(),
  },
  { requiredKeys: ['name', 'version'] },
);

// Mutated-invalid variants derived from a valid base, each violating exactly one
// schema rule the property cares about.
const invalidManifestArb: fc.Arbitrary<Record<string, unknown>> = fc.oneof(
  // bad permission enum value (Req 5.4)
  validManifestArb.map((m) => ({ ...m, permissions: [...((m.permissions as string[]) ?? []), 'admin'] })),
  // non-string dependency range (Req 5.5)
  validManifestArb.map((m) => ({
    ...m,
    dependencies: { ...(m.dependencies as Record<string, unknown>), badRange: 123 },
  })),
  // missing name
  validManifestArb.map((m) => {
    const { name: _name, ...rest } = m;
    return rest;
  }),
  // missing version
  validManifestArb.map((m) => {
    const { version: _version, ...rest } = m;
    return rest;
  }),
  // empty name
  validManifestArb.map((m) => ({ ...m, name: '' })),
  // empty version
  validManifestArb.map((m) => ({ ...m, version: '' })),
  // non-string name
  validManifestArb.map((m) => ({ ...m, name: 42 })),
);

const manifestArb = fc.oneof(validManifestArb, invalidManifestArb);

// ---- property ---------------------------------------------------------------

describe('Property 4: registration succeeds iff the manifest satisfies the schema', () => {
  it('passes the schema gate (and registers) iff the manifest conforms to pluginManifestSchema', () => {
    fc.assert(
      fc.property(manifestArb, (manifest) => {
        // Independent oracle: does the manifest conform to the published schema?
        const conforms = pluginManifestSchema.safeParse(manifest).success;

        // Fresh host per run (no publicKey => signature verification skipped, no
        // "already registered" collisions across runs).
        const host = new PluginHost();
        const plugin = makePlugin(manifest);

        if (conforms) {
          // Conforming => passes the gate; name/version match by construction and
          // no signature gate, so registration completes.
          assert.doesNotThrow(
            () => host.register(plugin, manifest as unknown as PluginManifest),
            `expected conforming manifest to register: ${JSON.stringify(manifest)}`,
          );
          assert.equal(
            host.has(manifest.name as string),
            true,
            `conforming manifest should be registered: ${JSON.stringify(manifest)}`,
          );
          assert.equal(host.list().length, 1, 'exactly one plugin should be registered');
        } else {
          // Non-conforming => rejected at the schema gate with PluginManifestError…
          assert.throws(
            () => host.register(plugin, manifest as unknown as PluginManifest),
            PluginManifestError,
            `expected non-conforming manifest to be rejected: ${JSON.stringify(manifest)}`,
          );
          // …and nothing is registered.
          assert.equal(
            host.list().length,
            0,
            `rejected manifest must not be registered: ${JSON.stringify(manifest)}`,
          );
        }
      }),
      { numRuns: 200 },
    );
  });
});
