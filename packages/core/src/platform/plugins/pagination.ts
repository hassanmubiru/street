// src/platform/plugins/pagination.ts
// Pure pagination helpers for the Network Plugin Registry. Zero dependencies —
// no third-party packages and no Node core imports needed; this is plain,
// deterministic arithmetic so it can be reused by the registry server and CLI
// and exercised by offline property tests in @streetjs/core.

/** Default page size when the caller does not request one (Req 4.6). */
export const DEFAULT_PAGE_SIZE = 25;
/** Smallest permitted page size (Req 4.6). */
export const MIN_PAGE_SIZE = 1;
/** Largest permitted page size (Req 4.6). */
export const MAX_PAGE_SIZE = 100;

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
export function normalizePageSize(requested: number | undefined): number {
  if (requested === undefined || !Number.isFinite(requested)) {
    return DEFAULT_PAGE_SIZE;
  }
  const n = Math.trunc(requested);
  if (n < MIN_PAGE_SIZE) return MIN_PAGE_SIZE;
  if (n > MAX_PAGE_SIZE) return MAX_PAGE_SIZE;
  return n;
}
