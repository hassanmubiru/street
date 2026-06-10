#!/usr/bin/env node
// scripts/observability/run-validate.mjs
//
// Advanced Observability — validation-pipeline verification driver (Req 10.9).
//
// Drives the zero-dependency `CommandRunner` from @streetjs/core to execute the
// observability validation pipeline (validate.mjs) and emit exactly one
// machine-readable Verification Artifact:
//
//     verification-artifacts/observability/observability.validate.artifact.json
//
// The artifact records the executed command, the command exit code, and an
// ISO-8601 timestamp (Req 10.9).
//
// The driver passes a PROMTOOL prerequisite probe to the runner: when promtool
// is unavailable the runner classifies the run as an honest BLOCKED with the
// specific missing prerequisite (`promtool`) — never a mock, never a false
// VERIFIED (Req 1.5). When promtool IS available, validate.mjs runs the offline
// validators AND the semantic `promtool check rules` + `promtool test rules`
// passes; its exit code drives the VERIFIED (all evidence present + exit 0) vs
// PARTIAL classification, and a validation failure fails the CI step recording
// the offending metric/asset or validation error (Req 10.7/10.8).
//
// Evidence hints: the capability ships source (the pipeline + validators) AND
// published documentation (the observability pack guide under docs/), so
// `documentation` is marked present; the runner derives the rest from the run.
//
// _Design: Components → Advanced Observability (validation pipeline); Testing
//  Strategy → CI integration and Honest BLOCKED. Requirements: 10.9, 1.5_

import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { CommandRunner } from 'streetjs';
import { probePromtool } from './lib.mjs';

const CAPABILITY_ID = 'observability.validate';

const HERE = dirname(fileURLToPath(import.meta.url));
const VALIDATE_SCRIPT = resolve(HERE, 'validate.mjs');
const REPO_ROOT = resolve(HERE, '..', '..');

export async function verifyObservability({ outRoot = 'verification-artifacts' } = {}) {
  const outDir = resolve(outRoot, 'observability');
  const runner = new CommandRunner();

  return runner.run({
    capabilityId: CAPABILITY_ID,
    command: `node ${JSON.stringify(VALIDATE_SCRIPT)}`,
    cwd: REPO_ROOT,
    // The single prerequisite: the promtool binary. A missing promtool
    // short-circuits the classification to an honest BLOCKED with id `promtool`.
    prerequisites: [async () => probePromtool()],
    // The observability pack guide is published documentation for this capability.
    evidenceHints: { documentation: true },
    outDir,
  });
}

async function main() {
  const { artifact, path } = await verifyObservability();

  console.log(`[observability-verify] ${artifact.capabilityId}: ${artifact.status} (exit ${artifact.exitCode})`);
  if (artifact.blockedReason) {
    console.log(`[observability-verify]   blocked: ${artifact.blockedReason.kind}/${artifact.blockedReason.missingPrerequisite}`);
  }
  console.log(`[observability-verify]   artifact: ${path}`);

  // Mirror the executed command's exit code: an honest promtool-absent BLOCKED
  // is exit 0 (does not fail CI); a genuine validation failure is non-zero.
  process.exitCode = artifact.exitCode;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(`[observability-verify] ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
  });
}
