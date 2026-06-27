# StreetJS OpenSSF Scorecard Review

> StreetJS against the OpenSSF Scorecard check set. Status: ✅ met · ◑ partial ·
> ⬜ unmet/unverified. Evidence cited per check. The repo already runs
> `scorecard.yml`, which produces the authoritative live score; this is the
> repo-grounded interpretation + remediation.

| Check | Status | Evidence / Action |
|---|---|---|
| Binary-Artifacts | ✅ | No checked-in binaries in source paths (wasm asset is a verified build input) |
| Branch-Protection | ⬜ | Platform setting — not verified in-repo. Apply `security/BRANCH-PROTECTION-REVIEW.md` |
| CI-Tests | ✅ | `ci-cd.yml` runs build+coverage on Node 20/22; 355 test files |
| CII-Best-Practices | ◑ | Pursue the OpenSSF Best Practices badge (roadmap P3) |
| Code-Review | ◑ | CODEOWNERS present; enforce via "require Code Owner review" branch rule |
| Contributors | ✅ | MAINTAINERS.md; multiple-org goal in governance |
| Dangerous-Workflow | ✅ | No `pull_request_target`; zizmor static analysis (`zizmor.yml`) |
| Dependency-Update-Tool | ✅ | `dependabot.yml` (npm, actions, docker) |
| Fuzzing | ◑ | `ci-cd.yml` `system-tests` includes a `fuzz-testing` suite + property-based tests; not OSS-Fuzz integrated |
| License | ✅ | MIT root + per-package (incl. all 21 plugins, added this cycle) |
| Maintained | ✅ | Active commits, releases, Dependabot |
| Packaging | ✅ | npm publish with provenance (`publish-plugins.yml`, `ci-cd.yml`) |
| Pinned-Dependencies | ✅ | Actions SHA-pinned; Docker base images digest-pinned |
| SAST | ✅ | CodeQL (`codeql.yml`) + zizmor |
| Secret scanning | ✅ | gitleaks + trufflehog (`secret-scan.yml`); push protection = platform ⬜ |
| Security-Policy | ✅ | `SECURITY.md` (reporting, SLA, CVE, plugin reporting) |
| Signed-Releases | ✅ | cosign/Sigstore (`ci-cd.yml`); Ed25519 plugin manifests |
| Token-Permissions | ✅ | All 38 workflows declare `permissions:`; default `contents: read` |
| Vulnerabilities | ◑ | Dependabot alerts triaged (vite bumped this cycle); keep zero open |

## Summary
**Strong** OpenSSF posture. The only hard ⬜ are platform-side (Branch-Protection,
push protection) — enable these and the live Scorecard rises materially. ◑ items
(Code-Review enforcement, Fuzzing depth, Best-Practices badge) are roadmap P2/P3.

## Priority actions
1. Enable branch protection + required Code-Owner review (Scorecard: Branch-Protection, Code-Review).
2. Enable GitHub push protection (Secret-Scanning).
3. Apply for the OpenSSF Best Practices badge (CII-Best-Practices).
4. Consider OSS-Fuzz onboarding (Fuzzing).

---

## OpenSSF Best Practices badge — "passing" self-assessment (#26)

> Maps the OpenSSF Best Practices (formerly CII) **passing**-tier criteria to
> repo evidence so a maintainer can complete the questionnaire at
> <https://www.bestpractices.dev>. Status: ✅ met · ◑ partial · ☐ operator/manual.
> The badge itself is granted by the BestPractices site (operator must register
> the project and submit) — this is the evidence pack to answer it quickly.

| # | Criterion (passing) | Status | Evidence |
|---|---|---|---|
| Basics | Project homepage + clear description | ✅ | README, GitHub Pages docs site |
| Basics | OSS license (OSI) | ✅ | MIT (root + all packages) |
| Basics | Documentation: how to install/use + API | ✅ | `docs/` (just-the-docs site), per-package READMEs |
| Basics | English support; maintained | ✅ | docs/issues in English; active releases |
| Change Control | Public VCS + tracked issues | ✅ | GitHub repo + Issues + templates |
| Change Control | Unique version numbering (SemVer) | ✅ | SemVer; `CHANGELOG.md` (Keep a Changelog) |
| Change Control | Release notes per release | ✅ | `CHANGELOG.md` |
| Reporting | Bug + vulnerability reporting process | ✅ | `SECURITY.md` + issue templates |
| Reporting | Vulnerability report private channel | ✅ | `SECURITY.md` coordinated disclosure (PGP key = operator ☐) |
| Quality | Working build system | ✅ | `tsc` workspace builds; `npm run build` |
| Quality | Automated test suite + CI | ✅ | `ci-cd.yml` (Node 20/22, coverage); node:test suites |
| Quality | New-functionality tests policy | ✅ | `CONTRIBUTING.md`; this cycle added tests with every runtime change |
| Quality | Warning flags enabled | ✅ | strict TS; `tsc --noEmit` lint; zizmor; CodeQL |
| Security | Secure development knowledge | ✅ | `THREAT-MODEL-2026.md`, `PLUGIN-SECURITY-STANDARD.md` |
| Security | Good cryptographic practices | ✅ | `node:crypto` only; Ed25519 signing; AES-256-GCM; constant-time verifiers |
| Security | TLS for network traffic | ◑ | Outbound HTTPS plugins; opt-in TLS for redis/mongodb/kafka/rabbitmq/nats (this cycle) |
| Security | Delivery against MITM | ✅ | npm provenance + Sigstore signed releases; SHA-pinned actions; digest-pinned images |
| Security | Patch known vulnerabilities | ✅ | Dependabot + `dependency-review.yml`; vite advisory cleared this cycle |
| Analysis | Static analysis | ✅ | CodeQL + zizmor |
| Analysis | Dynamic analysis | ◑ | `dast.yml` (Schemathesis + ZAP); fuzz suite present; OSS-Fuzz onboarding = roadmap (#18) |

**Gaps to reach the badge (all already tracked):** enable branch protection +
Code-Owner review (Code-Review), enable secret-scanning push protection, add a
real PGP key to `SECURITY.md`, and register/submit on bestpractices.dev. None are
code blockers — they are the [OPERATOR] actions in
`security/OPERATOR-EXECUTION-CHECKLIST.md`.
