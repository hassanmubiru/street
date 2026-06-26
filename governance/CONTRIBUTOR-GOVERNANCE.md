# StreetJS Contributor Governance

> How contributions are proposed, reviewed, and merged. Complements
> `CONTRIBUTING.md`, `GOVERNANCE.md`, `MAINTAINERS.md`, and `governance/CHARTER.md`.

## Roles
- **Maintainers** (`MAINTAINERS.md`) — merge rights, release authority.
- **Code owners** (`.github/CODEOWNERS`) — required reviewers per path. Currently
  single-owner (`@hassanmubiru`); **action: introduce `@org/*-team` ownership**
  (staged in `.github/CODEOWNERS.proposed`) to remove bus-factor.
- **Contributors** — anyone opening issues/PRs under the CoC.

## Review rules
- All changes via PR; no direct pushes to `main` (enforce via branch protection).
- **Require review from Code Owners** + ≥1 approval; dismiss stale approvals.
- Required status checks: `secrets-guard`, `build-and-test`, `verify-signing-anchor`,
  `secret-scan`, `codeql`, `repository-policy`, `security-baseline`.
- Security-sensitive paths (`official-key.ts`, `registry.ts`, `.github/workflows/`,
  payment/identity plugins) require security-team review (see CODEOWNERS).

## RFC process
- Substantial/breaking changes require an RFC in `rfcs/` (4 RFCs to date) with
  Code-Owner sign-off before implementation. Repo reorganizations that don't change
  published APIs are exempt.

## Issue & PR templates
- `.github/ISSUE_TEMPLATE/` (bug, feature, mentored task, config) and
  `.github/pull_request_template.md` are in place. Security issues must use private
  reporting, **not** public issues (`SECURITY.md`).

## Labels
- Managed via `.github/labels.yml` + `labels.yml` workflow (e.g. `dependencies`,
  `github-actions`, `npm`, `docker`, `frontend`, `security`).

## Security review process
- PRs touching the signing anchor, CI, or payment/identity plugins are blocked
  until security-team (CODEOWNERS) approval.
- New plugins must pass `security/PLUGIN-SECURITY-STANDARD.md` before first publish.
- Findings are tracked in `audits/` and `security/`; vulnerabilities follow the
  `SECURITY.md` disclosure + CVE process.

## Funding & community
- `.github/FUNDING.yml`; `GOOD-FIRST-ISSUES.md` (now under `docs/`) for onboarding.

## Gaps → actions
1. Broaden CODEOWNERS to teams (P1).
2. Enable branch protection so the review rules above are enforced server-side (P0).
3. Document a Security Champions program (roadmap P3).
