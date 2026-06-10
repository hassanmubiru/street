// src/cloud/runtime.ts
// Cloud-native runtime helpers: graceful shutdown hook, service-mesh detection,
// and Kubernetes External Metrics API autoscale endpoint.
/**
 * Register SIGTERM/SIGINT handlers that drain the HTTP server, close the
 * provided resources (DB pools, etc.), then exit cleanly. If the grace period
 * elapses first, the process is force-exited.
 *
 * Returns a disposer that removes the signal listeners (useful in tests).
 */
export function registerShutdownHook(app, opts = {}) {
    const graceMs = opts.graceMs ?? 30_000;
    const exit = opts.exit ?? ((code) => process.exit(code));
    let shuttingDown = false;
    const shutdown = async (signal) => {
        if (shuttingDown)
            return;
        shuttingDown = true;
        const force = setTimeout(() => exit(1), graceMs);
        force.unref();
        try {
            await app.close();
            for (const c of opts.closeables ?? []) {
                await c.close();
            }
            if (opts.onShutdown)
                await opts.onShutdown();
            clearTimeout(force);
            exit(0);
        }
        catch {
            clearTimeout(force);
            exit(1);
        }
    };
    const onTerm = () => { void shutdown('SIGTERM'); };
    const onInt = () => { void shutdown('SIGINT'); };
    process.once('SIGTERM', onTerm);
    process.once('SIGINT', onInt);
    return () => {
        process.removeListener('SIGTERM', onTerm);
        process.removeListener('SIGINT', onInt);
    };
}
// ── Service-mesh detection ────────────────────────────────────────────────────
/**
 * Detect whether the process is running inside an Istio or Linkerd mesh by
 * inspecting well-known injected environment variables.
 */
export function isRunningInServiceMesh(env = process.env) {
    return Boolean(env['ISTIO_META_MESH_ID']) || Boolean(env['LINKERD_PROXY_INJECTION_ENABLED']);
}
/**
 * Build a Kubernetes External Metrics API payload from runtime sources.
 * `requestsPerSecond` is derived from the telemetry request counter delta.
 */
export function buildAutoscaleMetrics(source, windowSeconds = 60) {
    let rps = 0;
    if (source.telemetry) {
        const snap = source.telemetry.snapshot();
        rps = windowSeconds > 0 ? snap.requestCount / windowSeconds : snap.requestCount;
    }
    const items = [
        { metricName: 'http_requests_per_second', value: String(Math.round(rps * 100) / 100) },
        { metricName: 'active_connections', value: String(source.activeConnections?.() ?? 0) },
        { metricName: 'queue_depth', value: String(source.queueDepth?.() ?? 0) },
    ];
    return { kind: 'ExternalMetricValueList', apiVersion: 'external.metrics.k8s.io/v1beta1', items };
}
/**
 * Register `GET /metrics/autoscale` on the app, returning the External Metrics
 * API payload as JSON.
 */
export function registerAutoscaleRoute(app, source, windowSeconds = 60) {
    app.use(async (ctx, next) => {
        if (ctx.method === 'GET' && ctx.path === '/metrics/autoscale') {
            ctx.json(buildAutoscaleMetrics(source, windowSeconds));
            return;
        }
        await next();
    });
}
//# sourceMappingURL=runtime.js.map