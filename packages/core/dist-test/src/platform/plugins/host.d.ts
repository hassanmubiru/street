import { type KeyLike } from 'node:crypto';
import type { MiddlewareFn } from '../../core/types.js';
import { PluginModule } from './sdk.js';
/** Permissions a plugin may request; the host grants a subset. */
export type PluginPermission = 'middleware' | 'events' | 'net' | 'fs' | 'db' | 'secrets';
export interface PluginManifest {
    name: string;
    version: string;
    /** Free-form capability tags used for discovery (e.g. 'payments', 'email'). */
    capabilities?: string[];
    /** Permissions the plugin needs to load; must be a subset of granted. */
    permissions?: PluginPermission[];
    /** Other plugins this one depends on: name → semver range. */
    dependencies?: Record<string, string>;
    /** SHA-256 hex of the canonical manifest body (integrity). */
    checksum?: string;
    /** Base64 Ed25519 signature over the checksum (authenticity). */
    signature?: string;
}
export declare class PluginError extends Error {
}
export declare class PluginPermissionError extends PluginError {
}
export declare class PluginDependencyError extends PluginError {
}
export declare class PluginSignatureError extends PluginError {
}
export declare class PluginStateError extends PluginError {
}
interface SemVer {
    major: number;
    minor: number;
    patch: number;
}
/** Parse "1.2.3" (ignoring any "-prerelease"/"+build" suffix). */
export declare function parseSemver(v: string): SemVer;
/** Compare two versions: -1 if a<b, 0 if equal, 1 if a>b. */
export declare function compareSemver(a: string, b: string): number;
/**
 * Does `version` satisfy `range`? Supports: '' / '*' (any), exact ("1.2.3"),
 * caret ("^1.2.3"), tilde ("~1.2.3"), and comparators (>=, >, <=, <).
 */
export declare function satisfiesVersion(version: string, range: string): boolean;
/** Compute the SHA-256 hex checksum of a manifest's canonical body. */
export declare function manifestChecksum(m: PluginManifest): string;
/** Sign a manifest with an Ed25519 private key; returns a manifest with checksum + signature set. */
export declare function signManifest(m: PluginManifest, privateKey: KeyLike): PluginManifest;
/**
 * Verify a manifest's integrity (checksum matches body) and authenticity
 * (Ed25519 signature over the checksum verifies against `publicKey`). Returns
 * true only if both hold. With no signature/publicKey, only integrity is checked.
 */
export declare function verifyManifest(m: PluginManifest, publicKey?: KeyLike): boolean;
export type PluginState = 'registered' | 'enabled' | 'disabled';
export interface PluginHostOptions {
    /** Permissions the host grants. '*' grants all. Default: none (plugins needing perms fail). */
    grantedPermissions?: PluginPermission[] | '*';
    /** Public key for verifying signed manifests. When set, registration requires a valid signature. */
    publicKey?: KeyLike;
}
/**
 * In-process plugin host. Register plugins with manifests, then enable them —
 * the host validates signatures (if configured), dependency presence + version
 * constraints, and permission grants, and drives lifecycle hooks in dependency
 * order. Disabling/removing respects reverse dependency order.
 */
export declare class PluginHost {
    private readonly entries;
    private readonly sandboxes;
    private readonly granted;
    private readonly publicKey;
    constructor(opts?: PluginHostOptions);
    /** Register a plugin + manifest. Validates name/version match and signature (if a public key is set). */
    register(plugin: PluginModule, manifest: PluginManifest): void;
    /** Discovery: all registered plugin names. */
    list(): string[];
    has(name: string): boolean;
    state(name: string): PluginState | undefined;
    manifestOf(name: string): PluginManifest | undefined;
    /** Discovery: registered plugins exposing a given capability tag. */
    findByCapability(capability: string): string[];
    /** Middlewares contributed by an enabled plugin (in registration order). */
    middlewaresOf(name: string): MiddlewareFn[];
    /**
     * Enable a plugin: verify permissions, ensure all dependencies are registered
     * and version-compatible and enabled (auto-enabling them first, in dependency
     * order), then run onInstall (once) and onLoad against a gated sandbox.
     */
    enable(name: string): Promise<void>;
    private _enable;
    /** Disable a plugin. Fails if an enabled plugin still depends on it. */
    disable(name: string): Promise<void>;
    /** Remove a plugin from the host. Must be disabled (or never enabled) first. */
    remove(name: string): Promise<void>;
    private _enabledDependentsOf;
}
export {};
//# sourceMappingURL=host.d.ts.map