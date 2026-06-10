// src/devx/upgrade.ts
// Upgrade System: version resolution + breaking-change analysis powering
// `street upgrade`. Pure logic, Node-core only (no third-party deps, no I/O).
//
// `resolveVersions` detects the installed version and resolves the target
// (defaulting to the latest available version). If either end cannot be
// resolved it throws an error naming the offending version and performs NO
// file writes — this module never touches the filesystem, so a thrown error
// guarantees the caller (`street upgrade`) halts before any mutation.
//
// `analyzeBreakingChanges` maps a resolved version pair to the ordered set of
// breaking changes crossed during the upgrade, each tagged with its affected
// area, an upgrade recommendation, and — iff an automated codemod is
// registered for it — that codemod's id (named in the recommendation).
import { compareSemver } from '../platform/plugins/host.js';
import { getCodemod } from './codemods.js';
/** Strict `MAJOR.MINOR.PATCH` (optionally `v`-prefixed, with pre-release/build
 *  suffix) check. Unlike the lenient `parseSemver`, this rejects partial or
 *  non-numeric versions so an unresolvable target is caught, not silently
 *  coerced to `0.0.0`. */
function isResolvableVersion(v) {
    if (typeof v !== 'string')
        return false;
    const core = v.trim().replace(/^v/, '');
    return /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z-.]+)?$/.test(core);
}
/**
 * Resolve the installed + target Framework versions (Req 8.1/8.2).
 *
 * - The target is taken from `targetArg` when supplied, otherwise it defaults
 *   to `latest`.
 * - `installed` is echoed through.
 * - If the installed version is unknown (`null`/unresolvable) or the resolved
 *   target is unresolvable, this throws an `Error` naming the version that
 *   could not be resolved. It performs no file writes.
 */
export function resolveVersions(opts) {
    const { targetArg, latest, installed } = opts;
    if (!isResolvableVersion(installed)) {
        throw new Error(`Could not resolve the installed Framework version${installed ? `: "${installed}"` : ''}. Aborting upgrade; no files were changed.`);
    }
    const target = targetArg !== undefined && targetArg !== '' ? targetArg : latest;
    if (!isResolvableVersion(target)) {
        throw new Error(`Could not resolve the target Framework version: "${target ?? ''}". ` +
            `Aborting upgrade; no files were changed.`);
    }
    return { installed, target };
}
/** Ordered catalog of known breaking changes across Framework versions. */
const BREAKING_CHANGE_CATALOG = [
    {
        id: 'rabbitmq-transport-rename',
        area: 'plugin-api',
        introducedIn: '1.0.0',
        description: 'The `RabbitMQTransport` plugin-API alias was renamed to the canonical `RabbitMqTransport`.',
        manualRecommendation: 'Rename all references to `RabbitMQTransport` to `RabbitMqTransport`.',
        codemodCandidate: 'rename-rabbitmq-transport',
    },
];
/**
 * Analyze the breaking changes crossed when upgrading from `installed` to
 * `target` (Req 8.3/8.4). Returns an ordered list; each entry records its
 * affected area, a non-empty recommendation, and a `codemodId` iff an
 * automated codemod is registered for it (the recommendation names that
 * codemod when present). Returns `[]` for a no-op or downgrade.
 */
export function analyzeBreakingChanges(r) {
    const { installed, target } = r;
    // Nothing to analyze unless we are moving forward.
    if (compareSemver(target, installed) <= 0)
        return [];
    const changes = [];
    for (const entry of BREAKING_CHANGE_CATALOG) {
        // Crossed iff installed < introducedIn <= target.
        const crossed = compareSemver(installed, entry.introducedIn) < 0 &&
            compareSemver(entry.introducedIn, target) <= 0;
        if (!crossed)
            continue;
        // Attach a codemodId only when the codemod is actually registered, so the
        // codemodId-iff-codemod-exists invariant holds against the live registry.
        const codemod = entry.codemodCandidate ? getCodemod(entry.codemodCandidate) : undefined;
        const codemodId = codemod?.id;
        changes.push({
            id: entry.id,
            area: entry.area,
            fromVersion: installed,
            toVersion: target,
            description: entry.description,
            ...(codemodId ? { codemodId } : {}),
            recommendation: codemodId
                ? `${entry.manualRecommendation} Run codemod "${codemodId}" to apply this automatically.`
                : entry.manualRecommendation,
        });
    }
    return changes;
}
//# sourceMappingURL=upgrade.js.map