// packages/search/src/internal.ts
// Shared runtime helpers used by both the barrel (index.ts) and the provider
// adapters (meili.ts, elastic.ts). Providers import runtime values from here —
// never from ./index.js — so the barrel does not form an import cycle with its
// own members (CodeQL/import-graph hygiene; mirrors @streetjs/storage).

/** Lowercase alphanumeric tokens of length >= 1. */
export function tokenize(text: string): string[] {
  return (text.toLowerCase().match(/[a-z0-9]+/g) ?? []);
}
