# StreetJS Repository Hardening Report — Phase 2

> Consolidated result of the Phase 2 hardening sprint. Read-only summary; all
> applied changes are governance/organization/CI/docs/security only — **no
> `packages/core` runtime code, no public docs removed, no CLI behavior changed**.

## 1. Structure audit vs Fastify / NestJS / Next.js / Kubernetes / OpenTelemetry

| Concern | Reference convention | StreetJS (after Phase 2) |
|---|---|---|
| Lean root | metadata only | ✅ 7 front-door `.md`; compose/Dockerfile moved out |
| `packages/` workspace | NestJS/Next | ✅ 49 packages |
| `docs/` `examples/` `benchmarks/` | all | ✅ |
| Dedicated `security/` + governance | OTel/K8s strong | ✅ `security/`, `governance/`, `audits/`, `plans/` |
| Infra under one dir | K8s (`cluster/`,`build/`) | ✅ `infra/{docker,kubernetes,helm,examples,monitoring}` |
| CODEOWNERS / OWNERS | all | ✅ `.github/CODEOWNERS` (+ team-based `.proposed`) |
| Pinned CI actions | OTel/K8s | ◑ core + new checkout SHA-pinned; gitleaks/trufflehog pin = follow-up |

**Files at root (correct):** README, LICENSE, CHANGELOG, CITATION, SECURITY,
GOVERNANCE, MAINTAINERS, CONTRIBUTING, CODE_OF_CONDUCT, package.json, lockfile,
dotfiles, `.env.example`. **Should move (remaining):** `BingSiteAuth.xml`,
`googledf528d4f2b039b20.html` → website repo. **Never commit:** keys/env/IaC-state
(enforced).

## 2. Deployment assets — DONE
- `Dockerfile` → `infra/docker/Dockerfile`; six `docker-compose*.yml` →
  `infra/docker/compose/`. Compose internals fixed to repo-root via `../../../`
  (build `context: ../../..`, `dockerfile: infra/docker/Dockerfile`, init volumes).
- **Validated with live `docker compose config`** for all six files (build context
  + volume sources resolve to repo root). Callers updated: `scripts/test-setup.sh`,
  `scripts/reliability/kafka-cold-start.sh`, `ci-cd.yml` docker-build,
  `deploy-verify.yml`, `scripts/cloud/kind-verify.mjs`; named-file doc refs updated.
  `repository-policy.yml` root allowlist updated to forbid root compose/Dockerfile.

## 3. Plugin security baseline — DONE
- Verified all 21 plugins have README/package.json/manifest.json/manifest.signed.json/
  manifest.pub/SECURITY.md; **added the missing `LICENSE`** (MIT) to all 21.
- Created `security/PLUGIN-SECURITY-STANDARD.md` (files, secrets, webhooks, SSRF/
  timeouts, signing, release).
- (Note: the prompt's `signed-manifest.json` is `manifest.signed.json` in this repo.)

## 4. Secret exposure — PASS
- See `security/SECRET-EXPOSURE-REPORT.md`. No keys/tokens/endpoints/doc-secrets.

## 5. CI hardening — DONE
- `scorecard.yml` already present (verified). Added `security-baseline.yml`
  (gitleaks + plugin standard + forbidden files). No `pull_request_target`;
  least-privilege perms; new workflows' checkout SHA-pinned.
- **Follow-up:** SHA-pin `gitleaks/gitleaks-action@v2` and `trufflesecurity/trufflehog@main`.

## 6–8. Branch / npm / infra reviews
- `security/BRANCH-PROTECTION-REVIEW.md`, `security/NPM-PUBLISH-SECURITY-REVIEW.md`,
  `security/INFRASTRUCTURE-SECURITY-REVIEW.md`.

## 9. Trust & compliance — DONE
- `security/TRUST-CENTER.md`.

## Risk score
**LOW–MEDIUM (~20/100 residual risk).** Trust model sound (rotation complete, all
manifests verified), no secrets exposed, CI broad and least-privilege. Residuals:
unpurged-but-distrusted history blob, two tracked SEO files, plugin timeout/webhook
gaps, platform branch/push protection pending.

## Remediation plan (priority)
1. **P0:** purge history blob; relocate on-disk keys; enable Secret Scanning +
   Push Protection + branch protection (signed commits).
2. **P1:** SHA-pin gitleaks/trufflehog actions; move SEO files to website repo;
   bind local compose DB ports to loopback; fill CODEOWNERS team handles.
3. **P2:** add outbound timeouts + webhook verifiers to plugins (framework code —
   separate change, out of this governance scope); install-side provenance verify docs.

## Migration plan & breaking-change analysis
- All moves are repo-internal (`git mv`, history preserved). **No published package
  path, import, or public API changed → zero consumer breakage.**
- CI/script/doc references updated and statically validated; final confirmation is
  a green CI run (`deploy-verify`, `observability`, `kafka-integration`, docker-build)
  + a local `docker compose up` smoke.
- Rollback: every change is a revertable commit.

## Constraints honored
- ✅ No `packages/core` runtime changes.
- ✅ No public docs removed.
- ✅ CLI untouched.
- ✅ No workflows removed (only added: `security-baseline.yml`; others extended).
- ✅ Plugin signing + provenance preserved (anchor verified).
- ✅ Marketplace data (`docs/_data`) references updated, not broken.
