import type { CliContext } from '../index.js';
/**
 * Job-queue metrics as embedded in the DiagnosticsServer snapshot. Mirrors
 * `JobQueueMetrics` from @streetjs/core, with optional forward-compatible
 * fields (`workers`, `dlqDepth`, `history`) the server may add later. When a
 * field is absent the dashboard renders it as "n/a" rather than failing.
 */
interface JobHistoryEntry {
    type: string;
    status: string;
    durationMs?: number;
    finishedAt?: string;
}
interface JobsMetrics {
    pending: number;
    inFlight: number;
    failed: number;
    succeeded: number;
    byType: Record<string, {
        avgDurationMs: number;
    }>;
    /** Active worker count, if the server reports it. */
    workers?: number;
    /** Dead-letter-queue depth, if the server reports it. */
    dlqDepth?: number;
    /** Recent job history entries (most-recent first), if the server reports them. */
    history?: JobHistoryEntry[];
}
interface JobsSnapshot {
    ts: string;
    jobs: JobsMetrics | null;
}
/**
 * Render the jobs dashboard for a single snapshot. Pure function (no I/O) so it
 * can be unit-tested directly.
 */
export declare function renderJobsTable(snapshot: JobsSnapshot): string;
export declare class JobsDashboardCommand {
    execute(ctx: CliContext): Promise<void>;
}
export {};
//# sourceMappingURL=jobs-dashboard.d.ts.map