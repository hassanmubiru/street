/** Default page size when the caller does not request one (Req 4.6). */
export declare const DEFAULT_PAGE_SIZE = 25;
/** Smallest permitted page size (Req 4.6). */
export declare const MIN_PAGE_SIZE = 1;
/** Largest permitted page size (Req 4.6). */
export declare const MAX_PAGE_SIZE = 100;
/**
 * Clamp a requested page size to the registry's bounds (Req 4.6).
 *
 * - `undefined` (or any non-finite value such as `NaN`/`Infinity`) yields the
 *   default of {@link DEFAULT_PAGE_SIZE} (25).
 * - Otherwise the value is truncated to an integer and clamped to
 *   `[MIN_PAGE_SIZE, MAX_PAGE_SIZE]` (`[1, 100]`).
 *
 * The result is always an integer in `[1, 100]`. Pure and deterministic.
 */
export declare function normalizePageSize(requested: number | undefined): number;
//# sourceMappingURL=pagination.d.ts.map