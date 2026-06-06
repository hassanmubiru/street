// src/diagnostics/socket-server.ts
// DiagnosticsServer: pushes live route and memory stats over a Unix domain socket.

import { createServer, type Server, type Socket } from 'node:net';
import { unlink, access } from 'node:fs/promises';
import type { RouteProfiler } from './route-profiler.js';
import type { JobQueueMetrics } from '../jobs/queue.js';

/**
 * Minimal structural view of a job-metrics provider (e.g. a `JobQueue`).
 * Declared structurally — rather than importing the concrete `JobQueue` class —
 * so the diagnostics server stays loosely coupled and free of import cycles.
 */
export interface JobMetricsSource {
  metrics(): Promise<JobQueueMetrics>;
}

export interface DiagnosticsServerOptions {
  /** Path to the Unix domain socket (default: /tmp/street-<pid>.sock) */
  socketPath?: string;
  /** RouteProfiler instance to snapshot */
  profiler: RouteProfiler;
  /** Optional job-metrics source (e.g. a JobQueue) to include in snapshots. */
  jobQueue?: JobMetricsSource;
}

export class DiagnosticsServer {
  private readonly _socketPath: string;
  private readonly _profiler: RouteProfiler;
  private readonly _jobQueue: JobMetricsSource | null;
  private _server: Server | null = null;
  private readonly _clients = new Set<Socket>();
  private _pushTimer: NodeJS.Timeout | null = null;

  constructor(opts: DiagnosticsServerOptions) {
    this._socketPath = opts.socketPath ?? `/tmp/street-${process.pid}.sock`;
    this._profiler = opts.profiler;
    this._jobQueue = opts.jobQueue ?? null;
  }

  /** Start listening on the Unix domain socket and push snapshots every second. */
  start(): void {
    if (this._server) return;

    const server = createServer((socket) => {
      this._clients.add(socket);
      socket.on('close', () => this._clients.delete(socket));
      socket.on('error', () => this._clients.delete(socket));
      // Send an immediate snapshot when a client connects
      void this._pushSnapshot(socket);
    });

    this._server = server;

    server.listen(this._socketPath, () => {
      // Socket is listening
    });

    server.on('error', (err) => {
      console.error('[diagnostics] Socket server error:', (err as Error).message);
    });

    // Push snapshot to all connected clients every second
    this._pushTimer = setInterval(() => {
      void this._broadcastSnapshot();
    }, 1000);
    this._pushTimer.unref();
  }

  /** Stop the server, close all clients, and remove the socket file. */
  stop(): void {
    if (this._pushTimer) {
      clearInterval(this._pushTimer);
      this._pushTimer = null;
    }

    for (const client of this._clients) {
      try { client.destroy(); } catch { /* ignore */ }
    }
    this._clients.clear();

    if (this._server) {
      this._server.close();
      this._server = null;
    }

    // Remove the socket file (best-effort)
    unlink(this._socketPath).catch(() => undefined);
  }

  // ── Private helpers ─────────────────────────────────────────────────────────

  private async _snapshot(): Promise<string> {
    const allStats: Record<string, unknown> = {};
    for (const [key, stats] of this._profiler.allStats()) {
      allStats[key] = stats;
    }

    // Job queue metrics are optional and backward compatible: when no job-metrics
    // source is configured the `jobs` field is null. Failures to read metrics are
    // swallowed (jobs: null) so diagnostics never crash the snapshot loop.
    let jobs: JobQueueMetrics | null = null;
    if (this._jobQueue) {
      try {
        jobs = await this._jobQueue.metrics();
      } catch {
        jobs = null;
      }
    }

    const mem = process.memoryUsage();
    const payload = {
      ts: new Date().toISOString(),
      routes: allStats,
      jobs,
      memory: {
        heapUsed: mem.heapUsed,
        heapTotal: mem.heapTotal,
        rss: mem.rss,
        external: mem.external,
      },
    };

    return JSON.stringify(payload) + '\n';
  }

  private async _pushSnapshot(socket: Socket): Promise<void> {
    try {
      const snapshot = await this._snapshot();
      if (!socket.destroyed) socket.write(snapshot);
    } catch { /* ignore write errors */ }
  }

  private async _broadcastSnapshot(): Promise<void> {
    const snapshot = await this._snapshot();
    for (const client of this._clients) {
      try {
        if (!client.destroyed) client.write(snapshot);
      } catch {
        this._clients.delete(client);
      }
    }
  }
}

/** Check if a given socket path is stale (process no longer running). */
export async function isStaleSocket(socketPath: string): Promise<boolean> {
  // Extract PID from filename like /tmp/street-12345.sock
  const match = socketPath.match(/street-(\d+)\.sock$/);
  if (!match) return false;

  const pid = parseInt(match[1]!, 10);
  if (isNaN(pid)) return false;

  // Check if file exists
  try {
    await access(socketPath);
  } catch {
    return false; // file doesn't exist — not stale
  }

  // Check if process is alive
  try {
    process.kill(pid, 0);
    return false; // process is alive
  } catch {
    return true; // process is dead — socket is stale
  }
}
