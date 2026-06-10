import type { StreetApp } from '../http/server.js';
import type { TelemetryTracker } from '../telemetry/tracker.js';
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
export declare function registerShutdownHook(app: StreetApp, opts?: ShutdownHookOptions): () => void;
/**
 * Detect whether the process is running inside an Istio or Linkerd mesh by
 * inspecting well-known injected environment variables.
 */
export declare function isRunningInServiceMesh(env?: NodeJS.ProcessEnv): boolean;
/** A single metric value in the Kubernetes External Metrics API shape. */
export interface ExternalMetricValue {
    metricName: string;
    value: string;
}
/** Kubernetes External Metrics API response envelope. */
export interface AutoscaleMetrics {
    kind: 'ExternalMetricValueList';
    apiVersion: 'external.metrics.k8s.io/v1beta1';
    items: ExternalMetricValue[];
}
export interface AutoscaleSource {
    telemetry?: TelemetryTracker;
    /** Returns the current number of active connections. */
    activeConnections?: () => number;
    /** Returns the current background queue depth. */
    queueDepth?: () => number;
}
/**
 * Build a Kubernetes External Metrics API payload from runtime sources.
 * `requestsPerSecond` is derived from the telemetry request counter delta.
 */
export declare function buildAutoscaleMetrics(source: AutoscaleSource, windowSeconds?: number): AutoscaleMetrics;
/**
 * Register `GET /metrics/autoscale` on the app, returning the External Metrics
 * API payload as JSON.
 */
export declare function registerAutoscaleRoute(app: StreetApp, source: AutoscaleSource, windowSeconds?: number): void;
//# sourceMappingURL=runtime.d.ts.map