// src/tenancy/metrics.ts
// Per-tenant metrics with LRU eviction at 10,000 tenants.

import type { MetricsRegistry, Counter, Gauge, Histogram } from '../observability/prometheus.js';
import { LruCache } from '../cache/lru.js';

// ── Migration SQL ──────────────────────────────────────────────────────────────

export const TENANT_DAILY_STATS_MIGRATION_SQL = `CREATE TABLE IF NOT EXISTS street_tenant_daily_stats (
  tenant_id TEXT NOT NULL,
  date DATE NOT NULL,
  metrics JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (tenant_id, date)
);`;

// ── TenantMetricsView ─────────────────────────────────────────────────────────

/**
 * A scoped metrics view for a single tenant.
 * All operations automatically add a `tenant_id` label.
 */
export class TenantMetricsView {
  constructor(
    private readonly _registry: MetricsRegistry,
    private readonly _tenantId: string,
  ) {}

  /**
   * Increment a counter metric for this tenant.
   * Registers the counter if it does not already exist.
   */
  counter(name: string, labels: Record<string, string> = {}): void {
    let metric: Counter;
    try {
      metric = this._registry.counter(name, `Tenant counter: ${name}`, ['tenant_id', ...Object.keys(labels)]);
    } catch {
      // Already registered — get it from the registry via a fresh Counter ref
      // The MetricsRegistry doesn't expose a `get`, so we work around it by
      // tracking metrics in a local map on the view.
      metric = _getOrRegisterCounter(this._registry, name, Object.keys(labels));
    }
    metric.inc({ tenant_id: this._tenantId, ...labels });
  }

  /**
   * Set a gauge metric value for this tenant.
   */
  gauge(name: string, value: number, labels: Record<string, string> = {}): void {
    let metric: Gauge;
    try {
      metric = this._registry.gauge(name, `Tenant gauge: ${name}`, ['tenant_id', ...Object.keys(labels)]);
    } catch {
      metric = _getOrRegisterGauge(this._registry, name, Object.keys(labels));
    }
    metric.set(value, { tenant_id: this._tenantId, ...labels });
  }

  /**
   * Record a histogram observation for this tenant.
   */
  observe(name: string, value: number, labels: Record<string, string> = {}): void {
    let metric: Histogram;
    try {
      metric = this._registry.histogram(name, `Tenant histogram: ${name}`, undefined, ['tenant_id', ...Object.keys(labels)]);
    } catch {
      metric = _getOrRegisterHistogram(this._registry, name, Object.keys(labels));
    }
    metric.observe(value, { tenant_id: this._tenantId, ...labels });
  }
}

// ── Metric caches (module-level) ──────────────────────────────────────────────
// MetricsRegistry throws on duplicate registration; we cache refs to avoid re-registration.
const _counterCache = new Map<string, Counter>();
const _gaugeCache = new Map<string, Gauge>();
const _histogramCache = new Map<string, Histogram>();

function _getOrRegisterCounter(registry: MetricsRegistry, name: string, extraLabels: string[]): Counter {
  const cached = _counterCache.get(name);
  if (cached) return cached;
  try {
    const c = registry.counter(name, `Tenant counter: ${name}`, ['tenant_id', ...extraLabels]);
    _counterCache.set(name, c);
    return c;
  } catch {
    // Another registration racing; return a no-op stub
    return { name, help: '', labelNames: [], inc: () => undefined, render: () => '' } as unknown as Counter;
  }
}

function _getOrRegisterGauge(registry: MetricsRegistry, name: string, extraLabels: string[]): Gauge {
  const cached = _gaugeCache.get(name);
  if (cached) return cached;
  try {
    const g = registry.gauge(name, `Tenant gauge: ${name}`, ['tenant_id', ...extraLabels]);
    _gaugeCache.set(name, g);
    return g;
  } catch {
    return { name, help: '', labelNames: [], set: () => undefined, render: () => '' } as unknown as Gauge;
  }
}

function _getOrRegisterHistogram(registry: MetricsRegistry, name: string, extraLabels: string[]): Histogram {
  const cached = _histogramCache.get(name);
  if (cached) return cached;
  try {
    const h = registry.histogram(name, `Tenant histogram: ${name}`, undefined, ['tenant_id', ...extraLabels]);
    _histogramCache.set(name, h);
    return h;
  } catch {
    return { name, help: '', labelNames: [], buckets: [], observe: () => undefined, render: () => '' } as unknown as Histogram;
  }
}

// ── TenantMetricsRegistry ─────────────────────────────────────────────────────

const DEFAULT_MAX_TENANTS = 10_000;

export class TenantMetricsRegistry {
  private readonly _views: LruCache<string, TenantMetricsView>;
  private readonly _registry: MetricsRegistry;

  constructor(registry: MetricsRegistry, maxTenants = DEFAULT_MAX_TENANTS) {
    this._registry = registry;
    this._views = new LruCache<string, TenantMetricsView>({
      maxEntries: maxTenants,
      ttlMs: 24 * 60 * 60 * 1000, // 24 hours
    });
  }

  /**
   * Returns (or creates) a `TenantMetricsView` for the given tenant ID.
   * Evicts the LRU entry automatically when the 10,000-tenant cap is reached.
   */
  forTenant(tenantId: string): TenantMetricsView {
    const existing = this._views.get(tenantId);
    if (existing) return existing;

    const view = new TenantMetricsView(this._registry, tenantId);
    this._views.set(tenantId, view);
    return view;
  }
}

// ── Daily usage aggregation (nightly cron job) ──────────────────────────────────

interface AggregationPool {
  query(sql: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[]; rowCount: number; command: string }>;
}

interface CronLike {
  register(expression: string, name: string, fn: () => Promise<void>): void;
}

/**
 * Aggregates per-metric `street_tenant_usage` rows for a given day into a single
 * JSONB summary row per tenant in `street_tenant_daily_stats`. Designed to run
 * nightly via `CronScheduler`.
 */
export class TenantUsageAggregator {
  constructor(private readonly pool: AggregationPool) {}

  /**
   * Aggregate usage for `period` (a DATE) into `street_tenant_daily_stats`.
   * Sums all `value`s per (tenant_id, metric_key) and upserts a JSONB map.
   * Returns the number of tenant rows written.
   */
  async aggregate(period: Date): Promise<number> {
    const day = period.toISOString().slice(0, 10);
    const result = await this.pool.query(
      `INSERT INTO street_tenant_daily_stats (tenant_id, date, metrics, created_at)
       SELECT tenant_id, period AS date,
              jsonb_object_agg(metric_key, value) AS metrics,
              NOW() AS created_at
         FROM street_tenant_usage
        WHERE period = $1
        GROUP BY tenant_id, period
       ON CONFLICT (tenant_id, date)
       DO UPDATE SET metrics = EXCLUDED.metrics, created_at = NOW()`,
      [day],
    );
    return result.rowCount;
  }

  /**
   * Register a nightly aggregation job (default 00:10 every day) on a
   * `CronScheduler`. Aggregates the previous day's usage.
   */
  scheduleNightly(scheduler: CronLike, name = 'tenant-usage-daily-aggregation', expression = '10 0 * * *'): void {
    scheduler.register(expression, name, async () => {
      const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
      await this.aggregate(yesterday);
    });
  }
}
