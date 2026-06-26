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
