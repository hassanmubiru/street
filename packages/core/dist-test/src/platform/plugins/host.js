// src/platform/plugins/host.ts
// Formal plugin system for Street: a local plugin host that handles
// registration, capability/permission metadata, dependency + version-constraint
// resolution, lifecycle orchestration (install/enable/disable/remove), discovery,
// and offline manifest integrity + Ed25519 signature verification.
//
// Built only on node:crypto — no third-party dependencies and no network. The
// network-based fetch/extract flow lives in registry.ts; this module is the
// in-process host that everything else (CLI, registry installer) drives.
import { createHash, verify as cryptoVerify, sign as cryptoSign } from 'node:crypto';
export class PluginError extends Error {
}
export class PluginPermissionError extends PluginError {
}
export class PluginDependencyError extends PluginError {
}
export class PluginSignatureError extends PluginError {
}
export class PluginStateError extends PluginError {
}
/** Parse "1.2.3" (ignoring any "-prerelease"/"+build" suffix). */
export function parseSemver(v) {
    const core = v.trim().replace(/^v/, '').split(/[-+]/)[0];
    const [maj, min, pat] = core.split('.');
    const n = (x) => {
        const r = Number.parseInt(x ?? '0', 10);
        return Number.isFinite(r) ? r : 0;
    };
    return { major: n(maj), minor: n(min), patch: n(pat) };
}
/** Compare two versions: -1 if a<b, 0 if equal, 1 if a>b. */
export function compareSemver(a, b) {
    const x = parseSemver(a), y = parseSemver(b);
    if (x.major !== y.major)
        return x.major < y.major ? -1 : 1;
    if (x.minor !== y.minor)
        return x.minor < y.minor ? -1 : 1;
    if (x.patch !== y.patch)
        return x.patch < y.patch ? -1 : 1;
    return 0;
}
/**
 * Does `version` satisfy `range`? Supports: '' / '*' (any), exact ("1.2.3"),
 * caret ("^1.2.3"), tilde ("~1.2.3"), and comparators (>=, >, <=, <).
 */
export function satisfiesVersion(version, range) {
    const r = range.trim();
    if (r === '' || r === '*' || r === 'x')
        return true;
    const ge = (v, base) => compareSemver(v, base) >= 0;
    const lt = (v, base) => compareSemver(v, base) < 0;
    if (r.startsWith('^')) {
        const b = parseSemver(r.slice(1));
        let upper;
        if (b.major > 0)
            upper = `${b.major + 1}.0.0`;
        else if (b.minor > 0)
            upper = `0.${b.minor + 1}.0`;
        else
            upper = `0.0.${b.patch + 1}`;
        return ge(version, r.slice(1)) && lt(version, upper);
    }
    if (r.startsWith('~')) {
        const b = parseSemver(r.slice(1));
        const upper = `${b.major}.${b.minor + 1}.0`;
        return ge(version, r.slice(1)) && lt(version, upper);
    }
    if (r.startsWith('>='))
        return compareSemver(version, r.slice(2).trim()) >= 0;
    if (r.startsWith('<='))
        return compareSemver(version, r.slice(2).trim()) <= 0;
    if (r.startsWith('>'))
        return compareSemver(version, r.slice(1).trim()) > 0;
    if (r.startsWith('<'))
        return compareSemver(version, r.slice(1).trim()) < 0;
    return compareSemver(version, r) === 0;
}
// ── Manifest integrity & signing ──────────────────────────────────────────────
/** Deterministic, key-sorted JSON of the signable manifest body (excludes checksum/signature). */
function canonicalManifest(m) {
    const body = {
        name: m.name,
        version: m.version,
        capabilities: [...(m.capabilities ?? [])].sort(),
        permissions: [...(m.permissions ?? [])].sort(),
        dependencies: Object.fromEntries(Object.entries(m.dependencies ?? {}).sort(([a], [b]) => (a < b ? -1 : 1))),
    };
    return JSON.stringify(body);
}
/** Compute the SHA-256 hex checksum of a manifest's canonical body. */
export function manifestChecksum(m) {
    return createHash('sha256').update(canonicalManifest(m)).digest('hex');
}
/** Sign a manifest with an Ed25519 private key; returns a manifest with checksum + signature set. */
export function signManifest(m, privateKey) {
    const checksum = manifestChecksum(m);
    const signature = cryptoSign(null, Buffer.from(checksum, 'utf8'), privateKey).toString('base64');
    return { ...m, checksum, signature };
}
/**
 * Verify a manifest's integrity (checksum matches body) and authenticity
 * (Ed25519 signature over the checksum verifies against `publicKey`). Returns
 * true only if both hold. With no signature/publicKey, only integrity is checked.
 */
export function verifyManifest(m, publicKey) {
    const expected = manifestChecksum(m);
    if (m.checksum !== undefined && m.checksum !== expected)
        return false;
    if (publicKey) {
        if (!m.signature)
            return false;
        try {
            return cryptoVerify(null, Buffer.from(expected, 'utf8'), publicKey, Buffer.from(m.signature, 'base64'));
        }
        catch {
            return false;
        }
    }
    return true;
}
/** A SandboxedApp whose capabilities are gated by the plugin's granted permissions. */
class GatedSandbox {
    perms;
    pluginName;
    middlewares = [];
    listeners = [];
    constructor(perms, pluginName) {
        this.perms = perms;
        this.pluginName = pluginName;
    }
    use(middleware) {
        if (!this.perms.has('middleware')) {
            throw new PluginPermissionError(`Plugin "${this.pluginName}" lacks 'middleware' permission`);
        }
        this.middlewares.push(middleware);
    }
    on(event, handler) {
        if (!this.perms.has('events')) {
            throw new PluginPermissionError(`Plugin "${this.pluginName}" lacks 'events' permission`);
        }
        this.listeners.push({ event, handler });
    }
}
const ALL_PERMS = ['middleware', 'events', 'net', 'fs', 'db', 'secrets'];
/**
 * In-process plugin host. Register plugins with manifests, then enable them —
 * the host validates signatures (if configured), dependency presence + version
 * constraints, and permission grants, and drives lifecycle hooks in dependency
 * order. Disabling/removing respects reverse dependency order.
 */
export class PluginHost {
    entries = new Map();
    sandboxes = new Map();
    granted;
    publicKey;
    constructor(opts = {}) {
        this.granted = new Set(opts.grantedPermissions === '*' ? ALL_PERMS : (opts.grantedPermissions ?? []));
        this.publicKey = opts.publicKey;
    }
    /** Register a plugin + manifest. Validates name/version match and signature (if a public key is set). */
    register(plugin, manifest) {
        if (manifest.name !== plugin.name || manifest.version !== plugin.version) {
            throw new PluginError(`Manifest (${manifest.name}@${manifest.version}) does not match plugin (${plugin.name}@${plugin.version})`);
        }
        if (this.entries.has(plugin.name)) {
            throw new PluginStateError(`Plugin "${plugin.name}" is already registered`);
        }
        if (this.publicKey && !verifyManifest(manifest, this.publicKey)) {
            throw new PluginSignatureError(`Plugin "${plugin.name}" failed manifest signature verification`);
        }
        this.entries.set(plugin.name, { plugin, manifest, state: 'registered', installed: false });
    }
    /** Discovery: all registered plugin names. */
    list() { return [...this.entries.keys()]; }
    has(name) { return this.entries.has(name); }
    state(name) { return this.entries.get(name)?.state; }
    manifestOf(name) { return this.entries.get(name)?.manifest; }
    /** Discovery: registered plugins exposing a given capability tag. */
    findByCapability(capability) {
        return [...this.entries.entries()]
            .filter(([, e]) => (e.manifest.capabilities ?? []).includes(capability))
            .map(([name]) => name);
    }
    /** Middlewares contributed by an enabled plugin (in registration order). */
    middlewaresOf(name) {
        return this.sandboxes.get(name)?.middlewares ?? [];
    }
    /**
     * Enable a plugin: verify permissions, ensure all dependencies are registered
     * and version-compatible and enabled (auto-enabling them first, in dependency
     * order), then run onInstall (once) and onLoad against a gated sandbox.
     */
    async enable(name) {
        await this._enable(name, new Set());
    }
    async _enable(name, visiting) {
        const entry = this.entries.get(name);
        if (!entry)
            throw new PluginDependencyError(`Plugin "${name}" is not registered`);
        if (entry.state === 'enabled')
            return;
        if (visiting.has(name)) {
            throw new PluginDependencyError(`Circular plugin dependency detected at "${name}"`);
        }
        visiting.add(name);
        // Permission check.
        for (const perm of entry.manifest.permissions ?? []) {
            if (!this.granted.has(perm)) {
                throw new PluginPermissionError(`Plugin "${name}" requires ungranted permission "${perm}"`);
            }
        }
        // Dependency resolution + version constraints (enable deps first).
        for (const [dep, range] of Object.entries(entry.manifest.dependencies ?? {})) {
            const depEntry = this.entries.get(dep);
            if (!depEntry)
                throw new PluginDependencyError(`Plugin "${name}" depends on missing plugin "${dep}"`);
            if (!satisfiesVersion(depEntry.manifest.version, range)) {
                throw new PluginDependencyError(`Plugin "${name}" requires "${dep}@${range}" but ${dep}@${depEntry.manifest.version} is registered`);
            }
            await this._enable(dep, visiting);
        }
        const sandbox = new GatedSandbox(new Set(entry.manifest.permissions ?? []), name);
        this.sandboxes.set(name, sandbox);
        if (!entry.installed) {
            if (entry.plugin.onInstall)
                await entry.plugin.onInstall();
            entry.installed = true;
        }
        if (entry.plugin.onLoad)
            await entry.plugin.onLoad(sandbox);
        entry.state = 'enabled';
        visiting.delete(name);
    }
    /** Disable a plugin. Fails if an enabled plugin still depends on it. */
    async disable(name) {
        const entry = this.entries.get(name);
        if (!entry)
            throw new PluginDependencyError(`Plugin "${name}" is not registered`);
        if (entry.state !== 'enabled')
            return;
        const dependents = this._enabledDependentsOf(name);
        if (dependents.length > 0) {
            throw new PluginDependencyError(`Cannot disable "${name}": still required by ${dependents.join(', ')}`);
        }
        const sandbox = this.sandboxes.get(name);
        if (entry.plugin.onUnload && sandbox)
            await entry.plugin.onUnload(sandbox);
        this.sandboxes.delete(name);
        entry.state = 'disabled';
    }
    /** Remove a plugin from the host. Must be disabled (or never enabled) first. */
    async remove(name) {
        const entry = this.entries.get(name);
        if (!entry)
            return;
        if (entry.state === 'enabled') {
            throw new PluginStateError(`Cannot remove enabled plugin "${name}"; disable it first`);
        }
        this.entries.delete(name);
        this.sandboxes.delete(name);
    }
    _enabledDependentsOf(name) {
        return [...this.entries.entries()]
            .filter(([other, e]) => other !== name
            && e.state === 'enabled'
            && Object.keys(e.manifest.dependencies ?? {}).includes(name))
            .map(([other]) => other);
    }
}
//# sourceMappingURL=host.js.map