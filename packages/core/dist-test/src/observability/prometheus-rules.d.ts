export interface RecordingRule {
    record: string;
    expr: string;
    labels?: Record<string, string>;
}
export interface AlertRule {
    alert: string;
    expr: string;
    for?: string;
    labels: Record<string, string>;
    annotations: Record<string, string>;
}
export type PromRule = RecordingRule | AlertRule;
export interface RuleGroup {
    name: string;
    interval?: string;
    rules: PromRule[];
}
export declare function isAlertRule(r: PromRule): r is AlertRule;
/** Recording rules: request rate, error ratio, and p95/p99 latency. */
export declare function streetRecordingRules(): RuleGroup;
/** Operational alerts: error rate, latency, and target liveness. */
export declare function streetAlertRules(): RuleGroup;
/**
 * Multi-window, multi-burn-rate SLO alerts for a 99.9% availability objective
 * (0.1% error budget). Fast burn (1h+5m windows, 14.4x) pages; slow burn
 * (6h+30m, 6x) warns. References the `job:http_error_rate` series.
 */
export declare function streetSloBurnRateRules(): RuleGroup;
/** Resource saturation alerts (references the real `process_heap_bytes` gauge). */
export declare function streetSaturationRules(): RuleGroup;
/** All default Street rule groups. */
export declare function streetRuleGroups(): RuleGroup[];
export interface RuleValidationResult {
    valid: boolean;
    errors: string[];
}
/**
 * Validate rule groups structurally and semantically (to the extent possible
 * without promtool): unique non-empty group names; each rule is exactly one of
 * recording (record+expr) or alert (alert+expr); non-empty exprs; alerts carry
 * a `severity` label and a `summary` annotation; durations look like Prometheus
 * durations.
 */
export declare function validatePrometheusRuleGroups(groups: RuleGroup[]): RuleValidationResult;
/** Serialize rule groups to a Prometheus-compatible `rule_files` YAML document. */
export declare function serializePrometheusRulesYaml(groups: RuleGroup[]): string;
//# sourceMappingURL=prometheus-rules.d.ts.map