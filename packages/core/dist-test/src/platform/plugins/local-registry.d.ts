import { type PluginManifest, type PluginHost } from './host.js';
import type { PluginModule } from './sdk.js';
/** A stored registry record: the signed manifest, publisher key, and metadata. */
export interface RegistryRecord {
    manifest: PluginManifest;
    /** Publisher public key (PEM, SPKI) used to verify the manifest signature. */
    publicKey: string;
    metadata: Record<string, unknown>;
    publishedAt: string;
}
/**
 * In-process signed plugin registry. Every published plugin must carry a valid
 * Ed25519-signed manifest; the signature is verified against the publisher's
 * public key at publish time and re-checked on `verify()`/`fetch()`.
 */
export declare class LocalPluginRegistry {
    private readonly store;
    /**
     * Publish a signed plugin. Verifies manifest integrity (checksum) and
     * authenticity (Ed25519 signature) against `publicKeyPem`. Rejects unsigned,
     * tampered, or wrong-key manifests, and duplicate name@version.
     */
    publish(manifest: PluginManifest, publicKeyPem: string, metadata?: Record<string, unknown>): RegistryRecord;
    /** Fetch a published record, re-verifying its signature. Throws if missing or invalid. */
    fetch(name: string, version: string): RegistryRecord;
    /** All published plugin ids (name@version). */
    list(): string[];
    /** Published records exposing a given capability tag. */
    search(capability: string): RegistryRecord[];
    /** Re-verify a stored plugin's signature against its stored public key. */
    verify(name: string, version: string): boolean;
    private _verifyRecord;
    /** Serialize the registry (for persistence by the caller). */
    toJSON(): RegistryRecord[];
    /** Rehydrate a registry from serialized records, re-verifying each signature. */
    static fromJSON(records: RegistryRecord[]): LocalPluginRegistry;
}
/**
 * Install a plugin through the registry into a {@link PluginHost}: fetch the
 * signed manifest (re-verified), register the supplied plugin instance against
 * it, and (by default) enable it. The plugin's identity must match the
 * registered manifest. Returns the registry record.
 */
export declare function installFromRegistry(registry: LocalPluginRegistry, host: PluginHost, plugin: PluginModule, opts?: {
    enable?: boolean;
}): Promise<RegistryRecord>;
//# sourceMappingURL=local-registry.d.ts.map