// tests/observability-structural-validity-pbt.test.ts
// Property-based test for Advanced Observability structural validity
// (Req 10.3 / 10.4 / 10.5). Kept in its own file so the universal property is
// exercised across the provided dashboards and rule groups without clobbering
// the example/edge-case unit tests in observability-pack.test.ts and
// observability-subsystem-pack.test.ts.
//
// Requirement 10.3: the Framework provides dashboards for PostgreSQL, Kafka,
//   RabbitMQ, HTTP, and Plugin Host.
// Requirement 10.4: the Framework provides alerts for latency, error rate,
//   queue depth, and memory pressure, each with a numeric trigger threshold and
//   an evaluation window.
// Requirement 10.5: the Framework provides an SLO Pack covering availability,
//   latency, and error budget, each with a numeric target and a measurement
//   window.
//
// This file proves, across the provided assets, that:
//   - every provided dashboard passes `validateGrafanaDashboard`;
//   - any non-empty selection of the provided rule groups passes
//     `validatePrometheusRuleGroups`;
//   - every provided alert carries a numeric threshold comparison and a valid
//     evaluation window; and
//   - every provided SLO objective carries a numeric target and a measurement
//     window.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';

import {
  streetApiDashboard,
  streetPostgresDashboard,
  streetKafkaDashboard,
  streetRabbitmqDashboard,
  streetPluginHostDashboard,
  streetDashboards,
  validateGrafanaDashboard,
  type GrafanaDashboard,
} from '../observability/grafana-dashboard.js';
import {
  streetAlertRules,
  streetSubsystemAlertRules,
  streetSaturationRules,
  streetSloPack,
  streetSloObjectives,
  streetRuleGroups,
  validatePrometheusRuleGroups,
  isAlertRule,
  type RuleGroup,
  type AlertRule,
} from '../observability/prometheus-rules.js';

const NUM_RUNS = 100;

// Prometheus duration shape, mirroring the validator's own DURATION matcher.
const DURATION = /^\d+[smhdwy]$/;

// A numeric threshold comparison: a comparison operator followed (optionally via
// an opening paren, for parenthesized burn-rate thresholds) by a number.
const NUMERIC_COMPARISON = /(<=|>=|==|!=|<|>)\s*\(?\s*-?\d/;

// The five dashboards required by Req 10.3, addressed by their stable uids.
// `streetApiDashboard` is the HTTP dashboard.
const REQUIRED_DASHBOARD_UIDS = [
  'street-postgres',
  'street-kafka',
  'street-rabbitmq',
  'street-api', // HTTP
  'street-plugin-host',
];

// All provided dashboards and the provided rule groups (full default set).
const allDashboards: GrafanaDashboard[] = streetDashboards();
const allRuleGroups: RuleGroup[] = streetRuleGroups();

// Every alert rule across the provided rule groups, paired with the group name.
const allAlerts: Array<{ group: string; alert: AlertRule }> = allRuleGroups.flatMap((g) =>
  g.rules.filter(isAlertRule).map((alert) => ({ group: g.name, alert })),
);

const sloObjectives = streetSloObjectives();

// Feature: platform-leadership-gaps, Property 27: Provided dashboards and rules are structurally valid
// Validates: Requirements 10.3, 10.4, 10.5
describe('Property 27: provided dashboards and rules are structurally valid', () => {
  it('every provided dashboard passes validateGrafanaDashboard (Req 10.3)', () => {
    // The five required subsystem dashboards are all present by uid.
    const uids = new Set(allDashboards.map((d) => d.uid));
    for (const uid of REQUIRED_DASHBOARD_UIDS) {
      assert.ok(uids.has(uid), `missing required dashboard "${uid}"`);
    }

    fc.assert(
      fc.property(fc.constantFrom(...allDashboards), (dashboard) => {
        const result = validateGrafanaDashboard(dashboard);
        assert.deepEqual(result.errors, []);
        assert.equal(result.valid, true);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('any non-empty selection of the provided rule groups passes validatePrometheusRuleGroups (Req 10.4, 10.5)', () => {
    fc.assert(
      fc.property(
        fc.subarray(allRuleGroups, { minLength: 1, maxLength: allRuleGroups.length }),
        (groups) => {
          const result = validatePrometheusRuleGroups(groups);
          assert.deepEqual(result.errors, []);
          assert.equal(result.valid, true);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it('every provided alert carries a numeric threshold comparison and a valid evaluation window (Req 10.4)', () => {
    assert.ok(allAlerts.length > 0, 'expected at least one provided alert');

    fc.assert(
      fc.property(fc.constantFrom(...allAlerts), ({ group, alert }) => {
        // Numeric trigger threshold: the expr contains a comparison against a number.
        assert.ok(
          NUMERIC_COMPARISON.test(alert.expr),
          `alert "${alert.alert}" in "${group}" lacks a numeric threshold comparison: ${alert.expr}`,
        );
        // Evaluation window: a present, valid Prometheus duration.
        assert.equal(typeof alert.for, 'string', `alert "${alert.alert}" missing evaluation window`);
        assert.ok(
          DURATION.test(alert.for as string),
          `alert "${alert.alert}" has an invalid evaluation window "${alert.for}"`,
        );
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('the four required alert signal classes are covered with numeric thresholds + windows (Req 10.4)', () => {
    const subsystem = streetSubsystemAlertRules();
    const result = validatePrometheusRuleGroups([subsystem]);
    assert.deepEqual(result.errors, []);

    const categories = new Set(
      subsystem.rules.filter(isAlertRule).map((a) => a.labels['category']),
    );
    for (const category of ['latency', 'error-rate', 'queue-depth', 'memory-pressure']) {
      assert.ok(categories.has(category), `missing alert category "${category}"`);
    }
  });

  it('every provided SLO objective carries a numeric target and a measurement window (Req 10.5)', () => {
    // The SLO Pack covers availability, latency, and error budget.
    const names = new Set(sloObjectives.map((o) => o.name));
    for (const name of ['availability', 'latency', 'error-budget']) {
      assert.ok(names.has(name), `missing SLO objective "${name}"`);
    }

    fc.assert(
      fc.property(fc.constantFrom(...sloObjectives), (objective) => {
        // Numeric target.
        assert.equal(typeof objective.target, 'number');
        assert.ok(Number.isFinite(objective.target), `SLO "${objective.name}" target is not finite`);
        // Measurement window: a valid Prometheus duration.
        assert.equal(typeof objective.window, 'string');
        assert.ok(
          DURATION.test(objective.window),
          `SLO "${objective.name}" has an invalid measurement window "${objective.window}"`,
        );
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('the SLO pack rule group itself is structurally valid (Req 10.5)', () => {
    // Reference the individual provided groups so the alert + SLO providers are
    // all exercised together.
    const groups = [streetAlertRules(), streetSubsystemAlertRules(), streetSaturationRules(), streetSloPack()];
    const result = validatePrometheusRuleGroups(groups);
    assert.deepEqual(result.errors, []);
    assert.equal(result.valid, true);

    // Sanity: the provided dashboards include the HTTP dashboard.
    assert.equal(streetApiDashboard().uid, 'street-api');
    // And the four subsystem dashboards are distinct objects.
    assert.equal(streetPostgresDashboard().uid, 'street-postgres');
    assert.equal(streetKafkaDashboard().uid, 'street-kafka');
    assert.equal(streetRabbitmqDashboard().uid, 'street-rabbitmq');
    assert.equal(streetPluginHostDashboard().uid, 'street-plugin-host');
  });
});
