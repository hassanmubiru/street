#!/usr/bin/env node
// scripts/registry/verify.mjs
//
// Network Plugin Registry publish→install verification driver (Requirement 4.8).
//
// Drives the zero-dependency `CommandRunner` from @streetjs/core to execute the
// publish→install END-TO-END harness (e2e.mjs) and emit exactly one
// machine-readable Verification Artifact:
//
//     verification-artifacts/registry/registry.publish-install.artifact.json
//
// The driver passes a CONTAINER-RUNTIME prerequisite probe to the runner: when
// no container runtime is available the runner classifies the run as an honest
// BLOCKED with the specific missing prerequisite (docker / docker-daemon /
// docker-image:…) — never a mock, never a false VERIFIED (Req 1.5). When a
// container IS available, e2e.mjs starts the registry server in a container and
// runs the full publish→install round trip; its exit code drives the VERIFIED
// (all evidence present + exit 0) vs PARTIAL classification.
//
// Evidence hints: the capability ships source (the registry server + harness)
// AND published documentation (the publishing + installation guides under
// docs/), so `documentation` is marked present; the runner derives the
// remaining components from the executed command.
//
// Exit code: mirrors the artifact's command exit code, so a genuine E2E failure
// fails the CI step while an honest BLOCKED (skipped harness, exit 0) does not.
//
// _Design: Components → Network Plugin Registry (E2E harness); Testing Strategy
//  → Layer B + Honest BLOCKED. Requirements: 4.8, 1.5_

import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { CommandRunner } from 'streetjs';
import { REPO_ROOT, probeContainerPrerequisites } from './lib.mjs';

const CAPABILITY_ID = 'registry.publish-install';

const HERE = dirname(fileURLToPath(import.meta.url));
const E2E_SCRIPT = resolve(HERE, 'e2e.mjs');

export async function verifyPublishInstall({ outRoot = 'verification-artifacts' } = {}) {
  const outDir = resolve(outRoot, 'registry');
  const runner = new CommandRunner();

  return runner.run({
    capabilityId: CAPABILITY_ID,
    command: `node ${JSON.stringify(E2E_SCRIPT)}`,
    cwd: REPO_ROOT,
    // The single prerequisite: a usable container runtime. A missing runtime
    // short-circuits the classification to BLOCKED with its specific id.
    prerequisites: [async () => probeContainerPrerequisites()],
    // The publishing + installation guides are published docs for this capability.
    evidenceHints: { documentation: true },
    outDir,
  });
}

async function main() {
  const { artifact, path } = await verifyPublishInstall();

  console.log(`[registry-verify] ${artifact.capabilityId}: ${artifact.status} (exit ${artifact.exitCode})`);
  if (artifact.blockedReason) {
    console.log(`[registry-verify]   blocked: ${artifact.blockedReason.kind}/${artifact.blockedReason.missingPrerequisite}`);
  }
  console.log(`[registry-verify]   artifact: ${path}`);

  // Mirror the executed command's exit code: an honest BLOCKED skip is exit 0
  // (does not fail CI), a genuine E2E failure is non-zero (fails CI).
  process.exitCode = artifact.exitCode;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(`[registry-verify] ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
  });
}
