#!/usr/bin/env node
// scripts/cloud/verify-offline.mjs
//
// Offline-verifiable verification for one Deployment Target (Requirements 2.14,
// 1.5). This is the credential-free half of the Cloud Deployment Verifier:
//
//   1. Run the pure offline-verifiable artifacts from @streetjs/core
//      (`runOfflineArtifacts`): manifest validation, task-def JSON-schema
//      validation, Helm chart structure, wrangler.toml structure, workflow lint.
//   2. Layer on the binary-backed offline artifacts when their tool is installed
//      (`helm lint`, `helm template`, `wrangler deploy --dry-run`).
//   3. Probe the deploy-time prerequisites (kubectl/helm/aws/gcloud/wrangler +
//      credentials). When one is missing, record the target BLOCKED with the
//      specific missing dependency id — while STILL attaching the offline
//      evidence so progress is provable. When all prerequisites are present,
//      the offline evidence is recorded as PARTIAL (offline-only evidence never
//      reaches VERIFIED; live verification is `verify-target.mjs`).
//
// The result is written, in the same `TargetVerification` shape the cross-target
// roll-up consumes, to:
//   verification-artifacts/cloud/targets/<target>.json
//
// Usage:
//   node scripts/cloud/verify-offline.mjs --target kubernetes
//   node scripts/cloud/verify-offline.mjs --target cloudflare-workers \
//     --name street-app --image registry.example.com/street-app:1.0.0 --port 8080

import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { runOfflineArtifacts, blockedTargetWithOfflineEvidence, targetDependencies } from 'streetjs';
import { parseFlags } from './lib.mjs';
import { probeTargetPrerequisites, runBinaryOfflineArtifacts } from './prereqs.mjs';

const SUPPORTED_TARGETS = [
  'kubernetes',
  'cloudrun',
  'ecs',
  'lambda',
  'azure-functions',
  'gcf',
  'cloudflare-workers',
];

/**
 * Produce the offline `TargetVerification` for a target. Pure offline evidence
 * is gathered from core; binary-backed offline checks are merged in; then the
 * prerequisite probe decides BLOCKED vs PARTIAL.
 */
export function verifyOffline(target, cfg, opts = {}) {
  // Steps 1 + 2 — collect the offline evidence (credential-free).
  const offline = runOfflineArtifacts(target, cfg);
  const binaryChecks = runBinaryOfflineArtifacts(target, { repoRoot: opts.repoRoot });
  if (binaryChecks.length > 0) {
    // Skipped (tool-absent) checks do not drag down `allPassed`.
    offline.checks = [...offline.checks, ...binaryChecks];
    offline.allPassed = offline.checks.every((c) => c.passed || c.skipped === true);
  }

  // Step 3 — probe deploy-time prerequisites; first missing dependency wins.
  const missing = probeTargetPrerequisites(target);
  if (missing) {
    const dep = targetDependencies(target).find((d) => d.id === missing.missingPrerequisite) ?? {
      id: missing.missingPrerequisite,
      kind: missing.kind,
      description: missing.missingPrerequisite,
    };
    return blockedTargetWithOfflineEvidence(target, dep, offline);
  }

  // Prerequisites satisfied: offline-only evidence is PARTIAL (never VERIFIED).
  return {
    target,
    status: 'PARTIAL',
    health: { live: false, ready: false, maxLatencyMs: 0 },
    boundViolations: ['live deployment not verified offline; run verify-target.mjs'],
    offlineArtifacts: offline,
  };
}

function main() {
  const flags = parseFlags(process.argv.slice(2));
  const target = flags.target;
  const outRoot = flags.out ?? 'verification-artifacts';

  if (!target || !SUPPORTED_TARGETS.includes(target)) {
    console.error(`[cloud-offline] --target must be one of: ${SUPPORTED_TARGETS.join(', ')}`);
    process.exitCode = 2;
    return;
  }

  const cfg = {
    name: flags.name ?? 'street-app',
    image: flags.image ?? 'registry.example.com/street-app:1.0.0',
    port: flags.port ? Number(flags.port) : 8080,
  };

  const result = verifyOffline(target, cfg, { repoRoot: flags['repo-root'] ?? process.cwd() });

  const outPath = resolve(outRoot, 'cloud', 'targets', `${target}.json`);
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify(result, null, 2));

  console.log(`[cloud-offline] ${target}: ${result.status}`);
  if (result.blockedReason) {
    console.log(`[cloud-offline]   blocked: ${result.blockedReason.kind}/${result.blockedReason.missingPrerequisite}`);
  }
  const offline = result.offlineArtifacts;
  if (offline) {
    console.log(`[cloud-offline]   offline evidence: ${offline.checks.filter((c) => c.passed).length}/${offline.checks.length} checks passed`);
    for (const c of offline.checks) {
      if (!c.passed && c.skipped !== true) console.log(`[cloud-offline]     FAIL ${c.name}: ${c.errors.join('; ')}`);
      if (c.skipped) console.log(`[cloud-offline]     SKIP ${c.name}: ${c.errors.join('; ')}`);
    }
  }
  console.log(`[cloud-offline]   result: ${outPath}`);

  // The offline evidence is informational; a BLOCKED prerequisite is not a
  // build failure (the target is honestly recorded). Exit 0 when every offline
  // check passed (or was skipped for an absent tool), 1 when an offline check
  // genuinely failed.
  const offlineOk = !offline || offline.allPassed;
  process.exitCode = offlineOk ? 0 : 1;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
