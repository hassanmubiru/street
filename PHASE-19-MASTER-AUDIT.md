# StreetJS — Phase 19 Governance, Security & Organization Master Audit

> **Type:** Read-only, evidence-grounded audit. Findings tagged
> **VERIFIED** (confirmed against repo contents/commands), **GAP** (something
> missing), **RISK** (exploitable/hygiene exposure), **RECOMMENDATION** (action).
> **Method:** `git ls-files`, `find`, `openssl`/`node` fingerprinting, and direct
> file reads on the working tree. Nothing is assumed.
> **Cross-references:** `SECURITY-AUDIT.md`, `PLUGIN-SECURITY-AUDIT.md`,
> `MARZPAY-SECURITY-REVIEW.md`, `REPO-ORGANIZATION-PLAN.md`,
> `PRIVACY-POLICY-FOR-REPO.md`, `KEY-ROTATION-RUNBOOK.md`.

## Material state change since the prior audit (VERIFIED)

The signing-key rotation is **functionally complete**, which changes the risk
picture materially:

- **VERIFIED** — `OFFICIAL_PLUGIN_PUBLIC_KEY_PEM` (`packages/core/src/platform/plugins/official-key.ts`)
  now embeds the new key, DER-SHA256 `3ae9add05d71dc5a17992caf192b1e465bcb9b2f2633231df44dbe2db8444b84`.
- **VERIFIED** — **all 21** `packages/plugin-*/manifest.pub` files match that new
  anchor (21/21, 0 mismatches). The half-finished rotation (old F-7) is resolved.
- **VERIFIED** — the previously-leaked official key (`df5e2726…`) is **no longer
  the trust anchor**, so a plugin forged with the leaked key now **fails**
  verification. The catastrophic exploitability of `SECURITY-AUDIT.md` F-1 is
  neutralised by rotation.
- **VERIFIED** — new CI gate `secrets-guard` (rule #1 in `ci-cd.yml`, gating the
  release chain) + standalone `block-private-keys.yml`; `.gitleaks.toml` corrected.
- **RISK (residual)** — the leaked blob is **still in history** (`d7bbfc40`,
  not yet purged) and on-disk keys remain in the tree (gitignored). These are now
  hygiene/defense-in-depth rather than active trust compromise.

---

# PHASE 1 — Repository Inventory

## Repository Asset Classification Matrix

### Root folders (VERIFIED via `find . -maxdepth 1 -type d`)

| Path | Class | Notes |
|---|---|---|
| `packages/` | Public OSS | 49 packages (21 `plugin-*`, core, cli, frontend, vertical kits) |
| `docs/` | Documentation | Jekyll site + reference; certification suite requires `docs/*.md` tracked |
| `examples/` | Public OSS | 13 example apps |
| `demos/` | Public OSS | 4 demos |
| `benchmarks/` | Public OSS | perf harness |
| `rfcs/` | Governance | design proposals |
| `deploy/` | Infrastructure | aws-ecs, cloud-run, cloudflare, helm, k8s, vercel |
| `observability/` | Infrastructure | grafana dashboards, prometheus rules |
| `verification-artifacts/` | Release | **generated** certification JSON (tracked — see Phase 2) |
| `ci/` | Infrastructure | pack-smoke fixtures |
| `dast/` | Security | DAST config |
| `scripts/` | Infrastructure | build/release/codegen scripts |
| `.github/` | Governance/Security | 36 workflows, CODEOWNERS, dependabot, codeql, templates |
| `.githooks/` | Security | pre-commit, pre-push |
| `app-htmx/` `app-next/` `app-none/` `app-react/` | Internal (generated) | scaffold output tracked at root |
| `keys/` | **HIGHLY SENSITIVE** | new signing keypair on disk (gitignored, untracked) |
| `node_modules/` `.git/` `.hypothesis/` `.vscode/` `.kiro/` | Internal | tooling/local (gitignored where appropriate) |

### Root files — classification (VERIFIED)

| Group | Examples | Class |
|---|---|---|
| Project metadata | `README.md`, `LICENSE`, `CHANGELOG.md`, `CITATION.cff`, `package.json`, `package-lock.json`, `.npmrc` | Public OSS |
| Governance | `GOVERNANCE.md`, `MAINTAINERS.md`, `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `SECURITY.md` | Governance |
| Tooling config | `.gitignore`, `.gitattributes`, `.gitleaks.toml`, `.dockerignore`, `.env.example` | Public OSS |
| Security deliverables | `SECURITY-AUDIT.md`, `SECURITY-AUDIT-2026.md`, `PLUGIN-SECURITY-AUDIT.md`, `MARZPAY-SECURITY-REVIEW.md`, `PAYMENTS-SECURITY-REVIEW.md`, `PLUGIN-SIGNING-REVIEW.md`, `THREAT-MODEL-2026.md`, `THREAT-MODEL-UPDATE.md`, `SECURITY-SCORECARD.md`, `KEY-ROTATION-RUNBOOK.md`, `PRIVACY-POLICY-FOR-REPO.md` | Security/Audit |
| Strategy / roadmap | `STREETJS-EXPANSION-MASTERPLAN.md`, `*-ROADMAP.md`, `*-PLAN.md`, `ADOPTION-ASSETS.md`, `COMMUNITY-GROWTH-PLAN.md`, `CONTENT-*.md`, `WEBSITE-EVOLUTION.md`, `TRUST-CENTER-PLAN.md`, `PHASE-18-*.md` | Internal |
| Completed reports | `ENTERPRISE-READINESS.md`, `ECOSYSTEM-PLUGINS-AUDIT.md`, `LANGUAGE-STATS-AUDIT.md`, `MARZPAY-INTEGRATION-REPORT.md`, `SHOWCASE-AUDIT.md`, `STREET_WEBSITE_ENTERPRISE_AUDIT.md`, `REPO-ORGANIZATION-PLAN.md` | Internal/Audit |
| Feature docs | `PLUGIN-MARKETPLACE.md`, `GOOD-FIRST-ISSUES.md` | Documentation |
| Generated (tracked) | `sbom.json`, `release-inputs.json`, `certification-report.json`, `RELEASE-CERTIFICATION.md` | Release (should be CI) |
| SEO verification (tracked) | `BingSiteAuth.xml`, `googledf528d4f2b039b20.html` | Internal (website) |
| Compose / container | `Dockerfile`, `docker-compose*.yml` (×6) | Infrastructure |
| Misc | `.sqlite-smoke.mjs` | Infrastructure |
| **SECRETS (gitignored, untracked)** | `.env`, `street-signing.key.pem`, `street-signing.pub.pem`, `keys/*` | **HIGHLY SENSITIVE** |

- **VERIFIED** — 45 tracked uppercase `*.md` files at root.
- **GAP** — root holds ~30 internal strategy/roadmap + ~14 audit docs, crowding the front door.
- **VERIFIED** — `.env`, `street-signing.key.pem`, `keys/street-signing-2026.key.pem` are gitignored (confirmed `git check-ignore`). **Not tracked.**
- **RISK** — `sbom.json`, `release-inputs.json`, `BingSiteAuth.xml`, `googledf528d4f2b039b20.html` **are tracked**.

### packages/* (VERIFIED — 49)

Core/platform: `core`, `core-compat`, `cli`, `edge`, `orm`, `registry-server`,
`search`, `storage`, `devtools`, `client`.
Frontend: `react`, `vue`, `next`, `nuxt`, `admin`, `admin-ui`, `ai`, `ai-ui`, `auth-ui`.
Verticals: `commerce`, `dating-auth`, `dating-messaging`, `dating-moderation`,
`dating-profiles`, `social-comments`, `social-feed`, `social-notifications`, `social-users`.
Plugins (21): `africastalking, auth0, clerk, firebase, htmx, kafka, marzpay,
mongodb, mysql, nats, openai, paypal, postgres, r2, rabbitmq, redis, s3, sendgrid,
stripe, supabase, twilio`.

### .github/* (VERIFIED)

36 workflows. Security-relevant: `codeql.yml`, `scorecard.yml`, `secret-scan.yml`,
`dependency-review.yml`, `dast.yml`, `sign-htmx.yml`, `publish-plugins.yml`,
`block-private-keys.yml` (new). Governance: `CODEOWNERS`, `dependabot.yml`,
`codeql/`, `ISSUE_TEMPLATE/`, `pull_request_template.md`, `FUNDING.yml`,
`labels.yml`, `zizmor.yml`, `actions/setup`.

### .githooks/* (VERIFIED) — `pre-commit`, `pre-push`.
### deploy/* (VERIFIED) — `aws-ecs/task-definition.json`, `cloud-run/service.yaml`, `cloudflare/wrangler.toml`, `helm/street`, `k8s/hpa-autoscaling-example.yaml`, `vercel/vercel.json`, `README.md`.
### observability/* (VERIFIED) — `grafana/dashboards`, `prometheus/street-rules.yml`, `prometheus/street-rules.test.yml`.
### verification-artifacts/* (VERIFIED) — ~40 tracked `*.artifact.json`/report files across abuse, cloud, dast, dating, devx, encryption, enterprise, headers, moderation, observability, plugins, privacy, ratelimit, registry, release, secrets, upgrade, upload, validation.
