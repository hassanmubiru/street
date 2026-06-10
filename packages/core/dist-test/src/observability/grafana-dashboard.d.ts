export interface GrafanaTarget {
    expr: string;
    legendFormat?: string;
    refId: string;
}
export interface GrafanaPanel {
    id: number;
    title: string;
    type: string;
    gridPos: {
        x: number;
        y: number;
        w: number;
        h: number;
    };
    targets: GrafanaTarget[];
    unit?: string;
}
export interface GrafanaDashboard {
    uid: string;
    title: string;
    schemaVersion: number;
    version: number;
    tags: string[];
    timezone: string;
    refresh: string;
    panels: GrafanaPanel[];
}
/** The default Street API dashboard: request rate, error ratio, p95/p99 latency. */
export declare function streetApiDashboard(): GrafanaDashboard;
/** Runtime/saturation dashboard: heap usage and request throughput. */
export declare function streetRuntimeDashboard(): GrafanaDashboard;
/** All default Street dashboards. */
export declare function streetDashboards(): GrafanaDashboard[];
export interface DashboardValidationResult {
    valid: boolean;
    errors: string[];
}
/** Validate a Grafana dashboard's required structure (uid/title/schema/panels/targets). */
export declare function validateGrafanaDashboard(d: unknown): DashboardValidationResult;
//# sourceMappingURL=grafana-dashboard.d.ts.map