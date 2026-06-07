// src/platform/plugins/local-registry.ts
// A local, dependency-free plugin registry. Stores signed manifests + their
// publisher public key + metadata, verifies signatures on publish and on
// demand, supports discovery (list/search), and integrates with PluginHost so
// a signed plugin can be published and installed through the registry. No
// network, no external services — purely in-process (with JSON (de)serialization
// for persistence by the caller).

import { createPublicKey, type KeyObject } from 'node:crypto';
import {
  verifyManifest, PluginError, PluginSignatureError, PluginStateError,
  type PluginManifest, type PluginHost,
} from './host.js';
import type { PluginModule } from './sdk.js';

/** A stored registry record: the signed manifest, publisher key, and metadata. */
export interface RegistryRecord {
  manifest: PluginManifest;  // includes checksum + signature
  /** Publisher public key (PEM, SPKI) used to verify the manifest signature. */
  publicKey: string;
  metadata: Record<string, unknown>;
  publishedAt: string;
}

function idOf(name: string, version: string): string {
  return `${name}@${version}`;
}

/**
 * In-process signed plugin registry. Every published plugin must carry a valid
 * Ed25519-signed manifest; the signature is verified against the publisher's
 * public key at publish time and re-checked on `verify()`/`fetch()`.
 */
export class LocalPluginRegistry {
  private readonly store = new Map<string, RegistryRecord>();

  /**
   * Publish a signed plugin. Verifies manifest integrity (checksum) and
   * authenticity (Ed25519 signature) against `publicKeyPem`. Rejects unsigned,
   * tampered, or wrong-key manifests, and duplicate name@version.
   */
  publish(manifest: PluginManifest, publicKeyPem: string, metadata: Record<string, unknown> = {}): RegistryRecord {
    if (!manifest.signature || !manifest.checksum) {
      throw new PluginError('Cannot publish: manifest is not signed (missing checksum/signature)');
    }
    let key: KeyObject;
    try {
      key = createPublicKey(publicKeyPem);
    } catch {
      throw new PluginError('Cannot publish: invalid public key (not a valid PEM/SPKI key)');
    }
    if (!verifyManifest(manifest, key)) {
      throw new PluginSignatureError(`Cannot publish "${manifest.name}@${manifest.version}": signature verification failed`);
    }
    const id = idOf(manifest.name, manifest.version);
    if (this.store.has(id)) {
      throw new PluginStateError(`Plugin "${id}" is already published`);
    }
    const record: RegistryRecord = {
      manifest, publicKey: publicKeyPem, metadata, publishedAt: new Date().toISOString(),
    };
    this.store.set(id, record);
    return record;
  }

  /** Fetch a published record, re-verifying its signature. Throws if missing or invalid. */
  fetch(name: string, version: string): RegistryRecord {
    const rec = this.store.get(idOf(name, version));
    if (!rec) throw new PluginError(`Plugin "${idOf(name, version)}" not found in registry`);
    if (!this._verifyRecord(rec)) {
      throw new PluginSignatureError(`Stored plugin "${idOf(name, version)}" failed signature re-verification`);
    }
    return rec;
  }

  /** All published plugin ids (name@version). */
  list(): string[] {
    return [...this.store.keys()];
  }

  /** Published records exposing a given capability tag. */
  search(capability: string): RegistryRecord[] {
    return [...this.store.values()].filter((r) => (r.manifest.capabilities ?? []).includes(capability));
  }

  /** Re-verify a stored plugin's signature against its stored public key. */
  verify(name: string, version: string): boolean {
    const rec = this.store.get(idOf(name, version));
    if (!rec) return false;
    return this._verifyRecord(rec);
  }

  private _verifyRecord(rec: RegistryRecord): boolean {
    try {
      return verifyManifest(rec.manifest, createPublicKey(rec.publicKey));
    } catch {
      return false;
    }
  }

  /** Serialize the registry (for persistence by the caller). */
  toJSON(): RegistryRecord[] {
    return [...this.store.values()];
  }

  /** Rehydrate a registry from serialized records, re-verifying each signature. */
  static fromJSON(records: RegistryRecord[]): LocalPluginRegistry {
    const reg = new LocalPluginRegistry();
    for (const r of records) {
      if (!reg._verifyRecord(r)) {
        throw new PluginSignatureError(`Refusing to load tampered registry record "${idOf(r.manifest.name, r.manifest.version)}"`);
      }
      reg.store.set(idOf(r.manifest.name, r.manifest.version), r);
    }
    return reg;
  }
}

/**
 * Install a plugin through the registry into a {@link PluginHost}: fetch the
 * signed manifest (re-verified), register the supplied plugin instance against
 * it, and (by default) enable it. The plugin's identity must match the
 * registered manifest. Returns the registry record.
 */
export async function installFromRegistry(
  registry: LocalPluginRegistry,
  host: PluginHost,
  plugin: PluginModule,
  opts: { enable?: boolean } = {},
): Promise<RegistryRecord> {
  const rec = registry.fetch(plugin.name, plugin.version); // throws on missing / bad signature
  host.register(plugin, rec.manifest);
  if (opts.enable !== false) await host.enable(plugin.name);
  return rec;
}
