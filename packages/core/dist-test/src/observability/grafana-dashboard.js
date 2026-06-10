// src/observability/grafana-dashboard.ts
// Grafana dashboard model for Street's default HTTP metrics + recording rules,
// with a structural validator. Emitting valid dashboard JSON lets operators
// import it directly or provision it via files. Dependency-free.
/** The default Street API dashboard: request rate, error ratio, p95/p99 latency. */
export function streetApiDashboard() {
    const panel = (id, title, type, x, y, targets, unit) => ({
        id, title, type, gridPos: { x, y, w: 12, h: 8 }, targets, ...(unit ? { unit } : {}),
    });
    return {
        uid: 'street-api',
        title: 'Street API',
        schemaVersion: 39,
        version: 1,
        tags: ['street', 'http'],
        timezone: 'browser',
        refresh: '30s',
        panels: [
            panel(1, 'Request rate (req/s)', 'timeseries', 0, 0, [
                { expr: 'job:http_request_rate:rate5m', legendFormat: 'rps', refId: 'A' },
            ], 'reqps'),
            panel(2, '5xx error ratio', 'timeseries', 12, 0, [
                { expr: 'job:http_error_rate:ratio5m', legendFormat: 'error ratio', refId: 'A' },
            ], 'percentunit'),
            panel(3, 'Latency p95', 'timeseries', 0, 8, [
                { expr: 'job:http_request_latency:p95', legendFormat: 'p95', refId: 'A' },
            ], 's'),
            panel(4, 'Latency p99', 'timeseries', 12, 8, [
                { expr: 'job:http_request_latency:p99', legendFormat: 'p99', refId: 'A' },
            ], 's'),
        ],
    };
}
/** Runtime/saturation dashboard: heap usage and request throughput. */
export function streetRuntimeDashboard() {
    const panel = (id, title, type, x, y, targets, unit) => ({
        id, title, type, gridPos: { x, y, w: 12, h: 8 }, targets, ...(unit ? { unit } : {}),
    });
    return {
        uid: 'street-runtime',
        title: 'Street Runtime',
        schemaVersion: 39,
        version: 1,
        tags: ['street', 'runtime', 'saturation'],
        timezone: 'browser',
        refresh: '30s',
        panels: [
            panel(1, 'Process heap (bytes)', 'timeseries', 0, 0, [
                { expr: 'process_heap_bytes', legendFormat: 'heap', refId: 'A' },
            ], 'bytes'),
            panel(2, 'Request rate (req/s)', 'timeseries', 12, 0, [
                { expr: 'job:http_request_rate:rate5m', legendFormat: 'rps', refId: 'A' },
            ], 'reqps'),
            panel(3, 'Error ratio', 'timeseries', 0, 8, [
                { expr: 'job:http_error_rate:ratio5m', legendFormat: 'error ratio', refId: 'A' },
            ], 'percentunit'),
            panel(4, 'Latency p99', 'timeseries', 12, 8, [
                { expr: 'job:http_request_latency:p99', legendFormat: 'p99', refId: 'A' },
            ], 's'),
        ],
    };
}
/** All default Street dashboards. */
export function streetDashboards() {
    return [streetApiDashboard(), streetRuntimeDashboard()];
}
/** Validate a Grafana dashboard's required structure (uid/title/schema/panels/targets). */
export function validateGrafanaDashboard(d) {
    const errors = [];
    const obj = d;
    if (typeof obj !== 'object' || obj === null)
        return { valid: false, errors: ['dashboard is not an object'] };
    if (!obj.uid)
        errors.push('missing uid');
    if (!obj.title)
        errors.push('missing title');
    if (typeof obj.schemaVersion !== 'number')
        errors.push('missing/invalid schemaVersion');
    if (!Array.isArray(obj.panels) || obj.panels.length === 0) {
        errors.push('dashboard must have at least one panel');
    }
    else {
        const ids = new Set();
        for (const p of obj.panels) {
            if (typeof p.id !== 'number')
                errors.push('panel missing numeric id');
            else if (ids.has(p.id))
                errors.push(`duplicate panel id ${p.id}`);
            ids.add(p.id);
            if (!p.title)
                errors.push(`panel ${p.id} missing title`);
            if (!Array.isArray(p.targets) || p.targets.length === 0)
                errors.push(`panel "${p.title}" has no targets`);
            else
                for (const t of p.targets) {
                    if (!t.expr || t.expr.trim() === '')
                        errors.push(`panel "${p.title}" has a target with empty expr`);
                    if (!t.refId)
                        errors.push(`panel "${p.title}" has a target missing refId`);
                }
        }
    }
    return { valid: errors.length === 0, errors };
}
//# sourceMappingURL=grafana-dashboard.js.map