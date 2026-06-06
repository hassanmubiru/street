import type { MiddlewareFn } from '../core/types.js';
export declare const STREET_API_EVENTS_MIGRATION_SQL: string;
export interface AnalyticsPool {
    query(sql: string, params?: unknown[]): Promise<{
        rows: Record<string, string | null>[];
        rowCount: number;
        command: string;
    }>;
}
export interface AnalyticsEvent {
    route: string;
    method: string;
    status: number;
    durationMs: number;
    userId: string | null;
    apiKeyId: string | null;
}
export interface AnalyticsServiceOptions {
    pool: AnalyticsPool;
    batchSize?: number;
    flushIntervalMs?: number;
    retentionDays?: number;
}
export interface RouteReportRow {
    route: string;
    method: string;
    count: number;
    avgLatencyMs: number;
    errorRate: number;
}
export interface AnalyticsReport {
    from: string;
    to: string;
    routes: RouteReportRow[];
}
export declare class AnalyticsService {
    private readonly _pool;
    private readonly _batchSize;
    private readonly _flushIntervalMs;
    private readonly _retentionDays;
    private _buffer;
    private _flushTimer;
    private _closed;
    constructor(opts: AnalyticsServiceOptions);
    /** Record an event into the in-memory buffer; flush when full. */
    record(event: AnalyticsEvent): void;
    /** Middleware that times the request and records an analytics event. */
    middleware(): MiddlewareFn;
    /** Flush buffered events to the DB in a single batched INSERT. */
    flush(): Promise<void>;
    /** Aggregate analytics for a time window: top routes by count, avg latency, error rate. */
    report(from: Date, to: Date): Promise<AnalyticsReport>;
    /** Delete events older than the configured retention period. Returns rows removed. */
    pruneOld(): Promise<number>;
    /** Stop the flush timer and flush any remaining buffered events. */
    close(): Promise<void>;
}
//# sourceMappingURL=analytics.d.ts.map