// tests/deployment-offline.test.ts
// Validates the prerequisite descriptors, the offline-verifiable artifacts, the
// workflow lint, and honest BLOCKED recording for the Cloud Deployment Verifier
// (Requirements 2.14, 1.5). All checks here run offline — no credentials, no
// network, no cloud connection.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  targetDependencies,
  lintWorkflow,
  runOfflineArtifacts,
  blockedTargetWithOfflineEvidence,
  classifyTargetVerification,
  generateTargetAssets,
  type DeploymentTarget,
  type DeployConfig,
} from '../cloud/deployment.js';

const config: DeployConfig = {
  name: 'street-app',
  image: 'registry.example.com/street-app:1.0.0',
  port: 8080,
  replicas: 2,
  cpu: '250m',
  memory: '256Mi',
  env: { NODE_ENV: 'production' },
};

const TARGETS: DeploymentTarget[] = [
  'kubernetes',
  'cloudrun',
  'ecs',
  'lambda',
  'azure-functions',
  'gcf',
  'cloudflare-workers',
];

describe('targetDependencies — declares deploy-time prerequisites', () => {
  for (const target of TARGETS) {
    it(`${target} declares at least one runtime and one credential dependency`, () => {
      const deps = targetDependencies(target);
      assert.ok(deps.length > 0, `${target}: no dependencies declared`);
      assert.ok(deps.some((d) => d.kind === 'runtime'), `${target}: no runtime dependency`);
      assert.ok(deps.some((d) => d.kind === 'credential'), `${target}: no credential dependency`);
      for (const d of deps) {
        assert.ok(typeof d.id === 'string' && d.id.length > 0, `${target}: empty dependency id`);
        assert.ok(typeof d.description === 'string' && d.description.length > 0);
      }
    });
  }

  it('kubernetes requires kubectl, helm, and KUBECONFIG', () => {
    const ids = targetDependencies('kubernetes').map((d) => d.id);
    assert.deepEqual(ids, ['kubectl', 'helm', 'KUBECONFIG']);
  });

  it('cloudflare-workers requires wrangler and the API token + account id', () => {
    const ids = targetDependencies('cloudflare-workers').map((d) => d.id);
    assert.ok(ids.includes('wrangler'));
    assert.ok(ids.includes('CLOUDFLARE_API_TOKEN'));
    assert.ok(ids.includes('CLOUDFLARE_ACCOUNT_ID'));
  });

  it('throws on an unknown target', () => {
    assert.throws(() => targetDependencies('mainframe' as DeploymentTarget), /unknown target/);
  });
});

describe('lintWorkflow — structural GitHub Actions workflow validation', () => {
  it('accepts every generated deploy workflow', () => {
    for (const target of TARGETS) {
      const assets = generateTargetAssets(target, config);
      for (const [path, content] of Object.entries(assets)) {
        if (path.startsWith('.github/workflows/') && path.endsWith('.yml')) {
          const r = lintWorkflow(content);
          assert.equal(r.valid, true, `${path}: ${r.errors.join('; ')}`);
        }
      }
    }
  });

  it('rejects an empty workflow', () => {
    assert.equal(lintWorkflow('').valid, false);
  });

  it('rejects a workflow missing jobs/steps', () => {
    const r = lintWorkflow('name: x\non:\n  push:\n');
    assert.equal(r.valid, false);
    assert.match(r.errors.join(';'), /jobs|runs-on|steps/);
  });
});

describe('runOfflineArtifacts — credential-free evidence per target', () => {
  for (const target of TARGETS) {
    it(`${target} offline artifacts all pass on generated assets`, () => {
      const offline = runOfflineArtifacts(target, config);
      assert.equal(offline.target, target);
      assert.ok(offline.checks.length > 0, `${target}: no offline checks`);
      assert.equal(
        offline.allPassed,
        true,
        `${target} failing checks: ${offline.checks.filter((c) => !c.passed).map((c) => `${c.name}(${c.errors.join(',')})`).join('; ')}`,
      );
    });
  }

  it('kubernetes runs manifest validation, k8s assets, and helm structure', () => {
    const offline = runOfflineArtifacts('kubernetes', config);
    const names = offline.checks.map((c) => c.name);
    assert.ok(names.includes('validateDeploymentManifest'));
    assert.ok(names.includes('helm-chart-metadata'));
    assert.ok(names.some((n) => n.startsWith('helm-template-')));
  });

  it('ecs runs task-def + service JSON-schema validation', () => {
    const offline = runOfflineArtifacts('ecs', config);
    const names = offline.checks.map((c) => c.name);
    assert.ok(names.includes('taskdef-schema'));
    assert.ok(names.includes('ecs-service-schema'));
  });

  it('throws on an unknown target', () => {
    assert.throws(() => runOfflineArtifacts('mainframe' as DeploymentTarget, config), /unknown target/);
  });
});

describe('blockedTargetWithOfflineEvidence — honest BLOCKED recording (Req 2.14)', () => {
  it('records BLOCKED with the specific missing dependency id while retaining offline evidence', () => {
    const offline = runOfflineArtifacts('kubernetes', config);
    const missing = targetDependencies('kubernetes').find((d) => d.id === 'kubectl');
    assert.ok(missing);
    const tv = blockedTargetWithOfflineEvidence('kubernetes', missing, offline);

    assert.equal(tv.status, 'BLOCKED');
    assert.equal(tv.blockedReason?.missingPrerequisite, 'kubectl');
    assert.equal(tv.blockedReason?.kind, 'runtime');
    assert.ok(tv.offlineArtifacts, 'offline evidence retained');
    assert.equal(tv.offlineArtifacts?.allPassed, true);
  });

  it('maps a missing credential dependency to kind=credential', () => {
    const offline = runOfflineArtifacts('cloudflare-workers', config);
    const missing = targetDependencies('cloudflare-workers').find((d) => d.id === 'CLOUDFLARE_API_TOKEN');
    assert.ok(missing);
    const tv = blockedTargetWithOfflineEvidence('cloudflare-workers', missing, offline);
    assert.equal(tv.blockedReason?.kind, 'credential');
    assert.equal(tv.blockedReason?.missingPrerequisite, 'CLOUDFLARE_API_TOKEN');
  });

  it('classifyTargetVerification preserves BLOCKED status and offline evidence', () => {
    const offline = runOfflineArtifacts('ecs', config);
    const missing = targetDependencies('ecs')[0];
    const tv = blockedTargetWithOfflineEvidence('ecs', missing, offline);
    const classified = classifyTargetVerification(tv);
    assert.equal(classified.status, 'BLOCKED');
    assert.equal(classified.blockedReason?.missingPrerequisite, missing.id);
    assert.ok(classified.offlineArtifacts, 'offline evidence survives classification');
  });
});
