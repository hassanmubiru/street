import type { MetricsRegistry } from '../observability/prometheus.js';
export declare const TENANT_DAILY_STATS_MIGRATION_SQL = "CREATE TABLE IF NOT EXISTS street_tenant_daily_stats (\n  tenant_id TEXT NOT NULL,\n  date DATE NOT NULL,\n  metrics JSONB NOT NULL DEFAULT '{}',\n  created_at TIMESTAMPTZ DEFAULT NOW(),\n  PRIMARY KEY (tenant_id, date)\n);";
/**
 * A scoped metrics view for a single tenant.
 * All operations automatically add a `tenant_id` label.
 */
export declare class TenantMetricsView {
    private readonly _registry;
    private readonly _tenantId;
    constructor(_registry: MetricsRegistry, _tenantId: string);
    /**
     * Increment a counter metric for this tenant.
     * Registers the counter if it does not already exist.
     */
    counter(name: string, labels?: Record<string, string>): void;
    /**
     * Set a gauge metric value for this tenant.
     */
    gauge(name: string, value: number, labels?: Record<string, string>): void;
    /**
     * Record a histogram observation for this tenant.
     */
    observe(name: string, value: number, labels?: Record<string, string>): void;
}
export declare class TenantMetricsRegistry {
    private readonly _views;
    private readonly _registry;
    constructor(registry: MetricsRegistry, maxTenants?: number);
    /**
     * Returns (or creates) a `TenantMetricsView` for the given tenant ID.
     * Evicts the LRU entry automatically when the 10,000-tenant cap is reached.
     */
    forTenant(tenantId: string): TenantMetricsView;
}
interface AggregationPool {
    query(sql: string, params?: unknown[]): Promise<{
        rows: Record<string, unknown>[];
        rowCount: number;
        command: string;
    }>;
}
interface CronLike {
    register(expression: string, name: string, fn: () => Promise<void>): void;
}
/**
 * Aggregates per-metric `street_tenant_usage` rows for a given day into a single
 * JSONB summary row per tenant in `street_tenant_daily_stats`. Designed to run
 * nightly via `CronScheduler`.
 */
export declare class TenantUsageAggregator {
    private readonly pool;
    constructor(pool: AggregationPool);
    /**
     * Aggregate usage for `period` (a DATE) into `street_tenant_daily_stats`.
     * Sums all `value`s per (tenant_id, metric_key) and upserts a JSONB map.
     * Returns the number of tenant rows written.
     */
    aggregate(period: Date): Promise<number>;
    /**
     * Register a nightly aggregation job (default 00:10 every day) on a
     * `CronScheduler`. Aggregates the previous day's usage.
     */
    scheduleNightly(scheduler: CronLike, name?: string, expression?: string): void;
}
export {};
//# sourceMappingURL=metrics.d.ts.map