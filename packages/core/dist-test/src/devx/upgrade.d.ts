export interface VersionResolution {
    installed: string;
    target: string;
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
export declare function resolveVersions(opts: {
    targetArg?: string;
    latest: string;
    installed: string | null;
}): VersionResolution;
export type BreakingArea = 'routing' | 'middleware' | 'plugin-api';
export interface BreakingChange {
    id: string;
    area: BreakingArea;
    fromVersion: string;
    toVersion: string;
    description: string;
    /** Present iff an automated codemod is registered for this change (Req 8.3/8.4). */
    codemodId?: string;
    /** The required source change; names the codemod when one is available (Req 8.4). */
    recommendation: string;
}
/**
 * Analyze the breaking changes crossed when upgrading from `installed` to
 * `target` (Req 8.3/8.4). Returns an ordered list; each entry records its
 * affected area, a non-empty recommendation, and a `codemodId` iff an
 * automated codemod is registered for it (the recommendation names that
 * codemod when present). Returns `[]` for a no-op or downgrade.
 */
export declare function analyzeBreakingChanges(r: VersionResolution): BreakingChange[];
//# sourceMappingURL=upgrade.d.ts.map