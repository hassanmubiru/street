# StreetJS Maturity Scoring Methodology

> Replaces subjective scores (e.g. "Security 86/100") with **measurable, reproducible**
> criteria anchored to recognized industry frameworks. Each dimension is scored as
> `points earned / points available`, where every point maps to a verifiable check.

## Frameworks used
- **OpenSSF Scorecard** (branch protection, pinned deps, CI tests, SAST, signing…)
- **SLSA v1.0** (build provenance levels)
- **NIST SSDF (SP 800-218)** (PO/PS/PW/RV practices)
- **OWASP ASVS v4** (verification requirements)
- **SLSA/SPDX/CycloneDX** (SBOM + provenance formats)
- **GitHub Security best practices** (secret scanning, push protection, CODEOWNERS)

## How a score is computed
Each dimension lists N binary/graded checks. A check is **MET** only if backed by a
repo artifact or a reproducible command. Score = `round(100 * met / total)`.
"Platform" checks (e.g. branch protection) that can't be verified from the tree are
marked **UNVERIFIED** and count as 0 until evidenced via settings-as-code.

## Dimension definitions (check sets)

### Security (maps to OpenSSF + ASVS supply-chain)
| Check | Evidence | Met |
|---|---|---|
| Signed releases | cosign in `ci-cd.yml` | ✅ |
| Signed plugin manifests + CI verify | `publish-plugins.yml`, `verify-signing-anchor` | ✅ |
| SAST (CodeQL) | `codeql.yml` | ✅ |
| Secret scanning (gitleaks+trufflehog) | `secret-scan.yml`, `.gitleaks.toml` | ✅ |
| Dependency review | `dependency-review.yml` | ✅ |
| Pinned CI actions | SHA pins | ✅ |
| No dangerous plugin constructs | scan: 0 eval/exec/any | ✅ |
| Branch protection | platform | ⬜ UNVERIFIED |
| Push protection | platform | ⬜ UNVERIFIED |
| History free of secrets | leaked blob present (distrusted) | ⬜ |
→ 7/10 = **70** verified; **86** projected once branch/push protection + purge land.

### Governance (maps to OpenSSF "Maintained" + GitHub practices)
SECURITY.md ✅, GOVERNANCE.md ✅, MAINTAINERS.md ✅, CODEOWNERS ✅ (single-owner ⬜ teams),
CONTRIBUTING ✅, CoC ✅, RFC process ✅, CHARTER ✅, RELEASE-POLICY ✅, CONTRIBUTOR-GOVERNANCE ✅
→ 9/10 (CODEOWNERS breadth) = **~72**, **90** with team ownership.

### Supply chain (SLSA + provenance)
Provenance ✅, SBOM ✅, signed artifacts ✅, pinned deps ✅, Dependabot ✅,
two-person review ⬜ (branch protection), hermetic/reproducible build ⬜
→ SLSA **~L2–L3** (see `security/SLSA-ASSESSMENT.md`).

### Release / Ecosystem / Docs / DX
Scored from `audits/REPOSITORY-METRICS.md` (counts) + `governance/RELEASE-POLICY.md`
(process) — see `audits/ENTERPRISE-READINESS-2026.md` for the composite table.

## Reproducibility
Re-running the commands in `audits/REPOSITORY-METRICS.md` and the per-check evidence
columns above regenerates every score. No subjective weighting is applied beyond the
equal-weight per-check model stated here.
