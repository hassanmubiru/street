// src/observability/analytics.ts
// API analytics: buffered event recording, batched inserts, aggregation report,
// and retention pruning. Built on the existing pool + cron primitives.
// ── Migration SQL ─────────────────────────────────────────────────────────────
export const STREET_API_EVENTS_MIGRATION_SQL = `
CREATE TABLE IF NOT EXISTS street_api_events (
  id          BIGSERIAL PRIMARY KEY,
  route       TEXT NOT NULL,
  method      TEXT NOT NULL,
  status      INT  NOT NULL,
  duration_ms DOUBLE PRECISION NOT NULL,
  user_id     TEXT,
  api_key_id  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS street_api_events_created_idx ON street_api_events (created_at);
CREATE INDEX IF NOT EXISTS street_api_events_route_idx   ON street_api_events (route);
`.trim();
// ── AnalyticsService ──────────────────────────────────────────────────────────
export class AnalyticsService {
    _pool;
    _batchSize;
    _flushIntervalMs;
    _retentionDays;
    _buffer = [];
    _flushTimer = null;
    _closed = false;
    constructor(opts) {
        this._pool = opts.pool;
        this._batchSize = opts.batchSize ?? 100;
        this._flushIntervalMs = opts.flushIntervalMs ?? 5_000;
        this._retentionDays = opts.retentionDays ?? 90;
        this._flushTimer = setInterval(() => {
            void this.flush();
        }, this._flushIntervalMs);
        this._flushTimer.unref();
    }
    /** Record an event into the in-memory buffer; flush when full. */
    record(event) {
        if (this._closed)
            return;
        this._buffer.push(event);
        if (this._buffer.length >= this._batchSize) {
            void this.flush();
        }
    }
    /** Middleware that times the request and records an analytics event. */
    middleware() {
        return async (ctx, next) => {
            const start = process.hrtime.bigint();
            try {
                await next();
            }
            finally {
                const durationMs = Number(process.hrtime.bigint() - start) / 1_000_000;
                const status = statusOf(ctx);
                const apiKeyId = typeof ctx.state?.['apiKeyId'] === 'string' ? ctx.state['apiKeyId'] : null;
                this.record({
                    route: ctx.path,
                    method: ctx.method,
                    status,
                    durationMs,
                    userId: ctx.user?.id ?? null,
                    apiKeyId,
                });
            }
        };
    }
    /** Flush buffered events to the DB in a single batched INSERT. */
    async flush() {
        if (this._buffer.length === 0)
            return;
        const batch = this._buffer;
        this._buffer = [];
        const perRow = 6;
        const valuesSql = [];
        const params = [];
        batch.forEach((e, i) => {
            const b = i * perRow;
            valuesSql.push(`($${b + 1}, $${b + 2}, $${b + 3}, $${b + 4}, $${b + 5}, $${b + 6})`);
            params.push(e.route, e.method, e.status, e.durationMs, e.userId, e.apiKeyId);
        });
        try {
            await this._pool.query(`INSERT INTO street_api_events (route, method, status, duration_ms, user_id, api_key_id)
         VALUES ${valuesSql.join(', ')}`, params);
        }
        catch (err) {
            // On failure, re-buffer the batch (bounded) so events aren't silently lost.
            if (this._buffer.length < this._batchSize * 10) {
                this._buffer.unshift(...batch);
            }
            throw err;
        }
    }
    /** Aggregate analytics for a time window: top routes by count, avg latency, error rate. */
    async report(from, to) {
        const result = await this._pool.query(`SELECT route, method,
              COUNT(*)                                    AS count,
              AVG(duration_ms)                            AS avg_latency,
              AVG(CASE WHEN status >= 400 THEN 1 ELSE 0 END) AS error_rate
       FROM street_api_events
       WHERE created_at >= $1 AND created_at <= $2
       GROUP BY route, method
       ORDER BY count DESC`, [from.toISOString(), to.toISOString()]);
        const routes = result.rows.map((r) => ({
            route: r['route'] ?? '',
            method: r['method'] ?? '',
            count: parseInt(r['count'] ?? '0', 10),
            avgLatencyMs: Math.round(parseFloat(r['avg_latency'] ?? '0') * 100) / 100,
            errorRate: Math.round(parseFloat(r['error_rate'] ?? '0') * 10000) / 10000,
        }));
        return { from: from.toISOString(), to: to.toISOString(), routes };
    }
    /** Delete events older than the configured retention period. Returns rows removed. */
    async pruneOld() {
        const result = await this._pool.query(`DELETE FROM street_api_events
       WHERE created_at < NOW() - ($1 || ' days')::interval`, [String(this._retentionDays)]);
        return result.rowCount;
    }
    /** Stop the flush timer and flush any remaining buffered events. */
    async close() {
        this._closed = true;
        if (this._flushTimer) {
            clearInterval(this._flushTimer);
            this._flushTimer = null;
        }
        await this.flush();
    }
}
function statusOf(ctx) {
    const res = ctx.res;
    return typeof res.statusCode === 'number' && res.statusCode > 0 ? res.statusCode : 200;
}
//# sourceMappingURL=analytics.js.map