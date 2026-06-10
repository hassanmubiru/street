// scripts/observability/lib.mjs
//
// Advanced Observability — validation-pipeline support library (Req 10.6 / 10.7
// / 10.8 / 10.9). These helpers back two scripts:
//
//   • validate.mjs     — the real validation command executed through the
//                        zero-dependency `CommandRunner`. It runs the offline
//                        validators (anti-fabrication metric-reference guard,
//                        Prometheus rule-group structure, Grafana dashboard
//                        structure) and, when promtool is available, the
//                        semantic `promtool check rules` + `promtool test rules`
//                        passes over the emitted rule files.
//   • run-validate.mjs — the CommandRunner driver. It runs the promtool
//                        prerequisite probe and emits the single machine-readable
//                        `observability.validate.artifact.json`.
//
// Zero-trust standard: when promtool is unavailable the driver records an honest
// BLOCKED with the specific missing prerequisite (`promtool`) — never a mock,
// never a false VERIFIED — while the offline validators still run and are
// recorded.

import { spawnSync } from 'node:child_process';
import {
  MetricsRegistry, prometheusMiddleware,
  registerSubsystemMetrics,
  streetRecordingRules, streetRuleGroups, validatePrometheusRuleGroups,
  streetDashboards, validateGrafanaDashboard,
  exportedMetricNames, validateMetricReferences,
} from 'streetjs';

/** The id recorded as the missing prerequisite when promtool is absent. */
export const PROMTOOL_PREREQUISITE = 'promtool';

/**
 * Whether the Prometheus `promtool` binary is available on PATH. Detection is
 * by spawn: a missing binary surfaces as a spawn error (ENOENT); any successful
 * spawn (even a non-zero exit) means the binary exists.
 */
export function hasPromtool() {
  const r = spawnSync('promtool', ['--version'], { stdio: 'ignore' });
  return !r.error;
}

/**
 * Prerequisite probe for the CommandRunner: returns `null` when promtool is
 * available, or a well-formed `BlockedReason` naming the specific missing
 * prerequisite when it is not. The shape (`{ missingPrerequisite, kind }`) is
 * exactly what the runner needs to record an honest BLOCKED (Req 1.5).
 */
export function probePromtool() {
  return hasPromtool() ? null : { missingPrerequisite: PROMTOOL_PREREQUISITE, kind: 'runtime' };
}

/**
 * Build the set of metric series the application actually exports — the
 * authority the anti-fabrication guard checks asset references against:
 *
 *   • default HTTP/process metrics (`http_requests_total`,
 *     `http_request_duration_seconds`, `process_heap_bytes`);
 *   • the PostgreSQL / Kafka / RabbitMQ / Plugin Host subsystem metrics;
 *   • recording-rule outputs (the `record:` series alerts/dashboards consume);
 *   • the Prometheus built-in `up` series (synthesized per scrape target by
 *     Prometheus itself — a real, universally-available series, not a
 *     fabricated app metric).
 *
 * Histograms expand to their `_bucket` / `_sum` / `_count` series via
 * `exportedMetricNames`.
 */
export function buildExportedMetricSet() {
  const registry = new MetricsRegistry();
  prometheusMiddleware(registry);     // http_requests_total, http_request_duration_seconds, process_heap_bytes
  registerSubsystemMetrics(registry); // db_*, kafka_*, rabbitmq_*, plugin_*
  const exported = exportedMetricNames(registry);

  for (const rule of streetRecordingRules().rules) {
    if (typeof rule.record === 'string') exported.add(rule.record);
  }
  exported.add('up');
  return exported;
}

/**
 * Run the three OFFLINE validators over the default observability pack and
 * return a structured result. The pipeline fails (`ok === false`) recording the
 * offending metric/asset (Req 10.7) or the structural validation error (Req
 * 10.8):
 *
 *   1. `validateMetricReferences` — anti-fabrication guard: every metric a
 *      dashboard panel or rule expression references must be an Exported Metric.
 *   2. `validatePrometheusRuleGroups` — rule-group structure/semantics.
 *   3. `validateGrafanaDashboard` — per-dashboard structure.
 *
 * Returns `{ ok, errors, violations }` where `errors` are human-readable lines
 * naming each offending metric/asset or validation error, and `violations` is
 * the raw `(metric, asset)` list from the anti-fabrication guard.
 */
export function runOfflineValidations() {
  const errors = [];
  const dashboards = streetDashboards();
  const rules = streetRuleGroups();

  // 1) Anti-fabrication metric-reference guard (Req 10.1 / 10.7).
  const exported = buildExportedMetricSet();
  const violations = validateMetricReferences(exported, { dashboards, rules });
  for (const v of violations) {
    errors.push(`metric-reference: asset "${v.asset}" references non-exported metric "${v.metric}"`);
  }

  // 2) Prometheus rule-group structural validation (Req 10.6 / 10.8).
  const rv = validatePrometheusRuleGroups(rules);
  if (!rv.valid) {
    for (const e of rv.errors) errors.push(`prometheus-rules: ${e}`);
  }

  // 3) Grafana dashboard structural validation (Req 10.6 / 10.8).
  for (const d of dashboards) {
    const dv = validateGrafanaDashboard(d);
    if (!dv.valid) {
      for (const e of dv.errors) errors.push(`grafana-dashboard[${d.uid}]: ${e}`);
    }
  }

  return { ok: errors.length === 0, errors, violations };
}
