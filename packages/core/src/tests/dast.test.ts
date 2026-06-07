// tests/dast.test.ts
// Verifies the offline-verifiable core of the DAST pipeline: OpenAPI artifact
// validation + scan-target enumeration over a real generateOpenApi() document,
// OWASP ZAP report normalization, and the severity-gated deterministic exit-code
// decision. The external scanners (Schemathesis, ZAP) are exercised by the CI
// workflow / scripts; this suite proves the gate logic that consumes them.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { generateOpenApi } from '../http/openapi.js';
import {
  validateOpenApiDocument, openApiOperations, parseZapReport,
  summarizeFindings, evaluateDastGate, type DastFinding,
} from '../security/dast.js';

describe('DAST — OpenAPI artifact validation & targets', () => {
  const doc = generateOpenApi([
    { method: 'GET', path: '/users', summary: 'list', responses: { '200': { description: 'ok' } } },
    { method: 'POST', path: '/users', summary: 'create' },
    { method: 'GET', path: '/users/:id', summary: 'get' },
  ]);

  it('accepts a real generateOpenApi() document', () => {
    const r = validateOpenApiDocument(doc);
    assert.equal(r.valid, true, r.errors.join('; '));
  });

  it('rejects malformed documents with precise errors', () => {
    assert.equal(validateOpenApiDocument(null).valid, false);
    assert.equal(validateOpenApiDocument({ openapi: '2.0', info: {}, paths: {} }).valid, false);
    const r = validateOpenApiDocument({ openapi: '3.1.0', info: { title: 'x', version: '1' }, paths: {} });
    assert.equal(r.valid, false);
    assert.match(r.errors.join(';'), /at least one path/);
  });

  it('enumerates scan targets (method + converted path) from the spec', () => {
    const targets = openApiOperations(doc);
    assert.deepEqual(
      targets.map((t) => `${t.method} ${t.path}`).sort(),
      ['GET /users', 'GET /users/{id}', 'POST /users'],
    );
  });
});

describe('DAST — OWASP ZAP report normalization', () => {
  // Realistic ZAP baseline JSON shape.
  const zapReport = {
    '@version': '2.14.0',
    site: [{
      '@name': 'http://localhost:8080',
      alerts: [
        { name: 'X-Content-Type-Options Header Missing', riskcode: '1', desc: 'low risk', instances: [{ uri: 'http://localhost:8080/' }] },
        { name: 'SQL Injection', riskcode: 3, desc: 'high risk', instances: [{ uri: 'http://localhost:8080/users' }, { uri: 'http://localhost:8080/items' }] },
        { name: 'Information Disclosure', riskcode: '0', instances: [] },
      ],
    }],
  };

  it('expands alerts and instances into normalized findings', () => {
    const findings = parseZapReport(zapReport);
    // 1 low (1 instance) + 1 high (2 instances) + 1 info (0 instances → 1 finding) = 4
    assert.equal(findings.length, 4);
    const high = findings.filter((f) => f.severity === 'high');
    assert.equal(high.length, 2);
    assert.equal(high[0]!.name, 'SQL Injection');
    assert.equal(high[0]!.url, 'http://localhost:8080/users');
    assert.equal(high[0]!.tool, 'owasp-zap');
  });

  it('handles empty/missing reports safely', () => {
    assert.deepEqual(parseZapReport({}), []);
    assert.deepEqual(parseZapReport(null), []);
  });
});

describe('DAST — severity gate & deterministic exit codes', () => {
  const findings: DastFinding[] = [
    { tool: 'owasp-zap', name: 'header missing', severity: 'low' },
    { tool: 'owasp-zap', name: 'sqli', severity: 'high', url: '/users' },
    { tool: 'schemathesis', name: 'unexpected 500', severity: 'critical', url: '/items' },
  ];

  it('fails (exit 2) on High/Critical by default', () => {
    const gate = evaluateDastGate(findings);
    assert.equal(gate.passed, false);
    assert.equal(gate.exitCode, 2);
    assert.equal(gate.failOn, 'high');
    assert.equal(gate.offending.length, 2); // high + critical
  });

  it('passes (exit 0) when nothing meets the threshold', () => {
    const lowOnly: DastFinding[] = [
      { tool: 'owasp-zap', name: 'a', severity: 'low' },
      { tool: 'owasp-zap', name: 'b', severity: 'medium' },
    ];
    const gate = evaluateDastGate(lowOnly);
    assert.equal(gate.passed, true);
    assert.equal(gate.exitCode, 0);
  });

  it('honours a custom failOn threshold', () => {
    const lowOnly: DastFinding[] = [{ tool: 'owasp-zap', name: 'b', severity: 'medium' }];
    assert.equal(evaluateDastGate(lowOnly, { failOn: 'medium' }).exitCode, 2);
    assert.equal(evaluateDastGate(lowOnly, { failOn: 'high' }).exitCode, 0);
  });

  it('summarizes counts by severity', () => {
    assert.deepEqual(summarizeFindings(findings), { info: 0, low: 1, medium: 0, high: 1, critical: 1 });
  });

  it('end-to-end: ZAP report → findings → gate decision', () => {
    const zap = { site: [{ alerts: [{ name: 'SQLi', riskcode: 3, instances: [{ uri: '/u' }] }] }] };
    const gate = evaluateDastGate(parseZapReport(zap));
    assert.equal(gate.exitCode, 2); // a High finding fails the build deterministically
  });
});
