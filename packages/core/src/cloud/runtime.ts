// src/cloud/runtime.ts
// Cloud-native runtime helpers: graceful shutdown hook, service-mesh detection,
// and Kubernetes External Metrics API autoscale endpoint.

import type { StreetApp } from '../http/server.js';
import type { TelemetryTracker } from '../telemetry/tracker.js';

// ── Graceful shutdown ─────────────────────────────────────────────────────────

export interface Closeable {
  close(): Promise<void> | void;
}

export interface ShutdownHookOptions {
  /** Grace period before forced exit (ms). Default 30_000. */
  graceMs?: number;
  /** Resources to close in order after the HTTP listener stops. */
  closeables?: Closeable[];
  /** Called after all closeables are closed, before process.exit. */
  onShutdown?: () => Promise<void> | void;
  /** Override the exit function (testing). */
  exit?: (code: number) => void;
}

/**
 * Register SIGTERM/SIGINT handlers that drain the HTTP server, close the
 * provided resources (DB pools, etc.), then exit cleanly. If the grace period
 * elapses first, the process is force-exited.
 *
 * Returns a disposer that removes the signal listeners (useful in tests).
 */
export function registerShutdownHook(app: StreetApp, opts: ShutdownHookOptions = {}): () => void {
  const graceMs = opts.graceMs ?? 30_000;
  const exit = opts.exit ?? ((code: number) => process.exit(code));
  let shuttingDown = false;

  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;

    const force = setTimeout(() => exit(1), graceMs);
    force.unref();

    try {
      await app.close();
      for (const c of opts.closeables ?? []) {
        await c.close();
      }
      if (opts.onShutdown) await opts.onShutdown();
      clearTimeout(force);
      exit(0);
    } catch {
      clearTimeout(force);
      exit(1);
    }
  };

  const onTerm = (): void => { void shutdown('SIGTERM'); };
  const onInt = (): void => { void shutdown('SIGINT'); };
  process.once('SIGTERM', onTerm);
  process.once('SIGINT', onInt);

  return () => {
    process.removeListener('SIGTERM', onTerm);
    process.removeListener('SIGINT', onInt);
  };
}
