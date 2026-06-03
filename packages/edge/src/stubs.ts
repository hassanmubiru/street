// packages/edge/src/stubs.ts
// Stub implementations for Node.js APIs not available in Edge runtimes.

export class EdgeRuntimeStub {
  static readonly unavailableApis: ReadonlyArray<string> = [
    'fs',
    'net',
    'tls',
    'dns',
    'child_process',
    'worker_threads',
    'v8',
  ];

  /**
   * Returns true if the current environment is an Edge runtime
   * (Vercel Edge, Cloudflare Workers, Deno Deploy, etc.)
   */
  static isEdgeRuntime(): boolean {
    return (
      typeof (globalThis as Record<string, unknown>)['EdgeRuntime'] === 'string' ||
      typeof (globalThis as Record<string, unknown>)['caches'] !== 'undefined' && typeof process === 'undefined'
    );
  }
}

/**
 * Minimal Request/Response polyfills for environments that don't have
 * the global Fetch API. In modern Edge runtimes (CF Workers, Vercel Edge,
 * Deno) these are available natively — the stubs are only used in tests
 * or Node.js <18 environments.
 */
export type EdgeRequest = Request;
export type EdgeResponse = Response;
