# StreetJS Enterprise Readiness 2026

> Final enterprise-readiness report. Evidence-based; all scores trace to
> `audits/SCORING-METHODOLOGY.md` and `audits/REPOSITORY-METRICS.md`. Comparisons
> are limited to publicly-observable practices.

## Executive summary
StreetJS is a security-forward TypeScript framework (49 packages, 21 signed
plugins, CLI, docs, SaaS starter) with a verified plugin trust model, layered CI
security gates, and mature-framework repository structure. The historical critical
(leaked signing anchor) is remediated by a completed rotation. Remaining work is
**operator/platform** (branch protection, history purge) and **plugin runtime**
(HTTP timeouts, webhook verifiers) — neither blocks adoption.

**Verdict: enterprise-adoptable today (GO WITH CONDITIONS).**

## Repository health (from REPOSITORY-METRICS.md)
49 packages · 21 plugins (21 signed) · 13 examples · 4 demos · 4 RFCs · 38
workflows · 229 doc pages · 355 test files · 91 scripts. Root reduced 45 → 7 `.md`.

## Maturity scorecard (methodology-backed)
| Dimension | Score | Basis |
|---|---|---|
| Repository organization | 88 | metrics + mature-framework layout |
| Security | 70 verified / 86 projected | OpenSSF + ASVS checks (`OPENSSF-REVIEW.md`) |
| Supply chain | SLSA Build **L2** (L3 targeted) | `SLSA-ASSESSMENT.md` |
| Governance | 72 / 90 projected | charter/CODEOWNERS/RFC (`CONTRIBUTOR-GOVERNANCE.md`) |
| Compliance alignment | SSDF ✅ / ASVS ◑ | `NIST-SSDF-MAPPING.md`, `OWASP-ASVS-MAPPING.md` |
| Release engineering | strong | provenance + SBOM + signing (`RELEASE-POLICY.md`) |
| Plugin ecosystem | strong (trust) | `PLUGIN-MATURITY-MATRIX.md` |
| Documentation | 82 | 229 pages; gap = versioned/searchable hosted docs |
| Developer experience | 80 | CLI, scaffolds, certification suites |
| **Composite** | **~82/100** | equal-weight per methodology |

## Phase 14 — Benchmark vs leading frameworks (evidence-based)
| Dimension | Next/Nuxt/Nest | Laravel | Express/Fastify/Vite | Bun/Deno | StreetJS |
|---|---|---|---|---|---|
| Repo organization | high | high | medium | high | **high** |
| Governance | high | high | low–medium | medium | **medium–high** |
| Security (supply chain) | medium–high | medium | low | medium–high | **high (signed+verified plugins)** |
| Plugin ecosystem | high (breadth) | high | medium | low | **high trust / smaller catalog** |
| CI/CD | high | high | medium | high | **high** |
| Release/provenance | high | medium | low–medium | high | **high** |
| Docs | high (versioned/search) | high | medium | high | **medium (gap: versioning/search)** |
| DX | very high | high | high | high | **high** |

**Where StreetJS leads:** plugin signing + CI verification + provenance exceeds
Express/Fastify/Vite and matches or exceeds most on supply-chain integrity.
**Where it trails:** ecosystem breadth and hosted-docs versioning/search (Next/Laravel).

## Compliance alignment
SSDF: PO/PS/PW/RV largely ✅ (gaps: ownership breadth, branch protection).
ASVS: V1–V14 ✅/◑ (gaps: DB TLS options, webhook verifiers). OpenSSF: strong; hard
gaps are platform branch/push protection. SLSA: L2 now, L3 after branch protection
+ keyless signing.

## Remaining risks
1. (HIGH) Leaked key blob in history — distrusted, unpurged.
2. (HIGH) On-disk keys in tree (gitignored).
3. (MED) Branch/push protection not enforced.
4. (MED) Plugin HTTP timeouts + webhook verifiers (runtime).
5. (MED) Single-owner CODEOWNERS.
6. (LOW) `web/` lockfiles; SEO files; `app-*` at root; `verification-artifacts/` tracked; docs versioning.

## Recommended next steps
- **P0:** branch + push protection; purge history; relocate keys (`SECURITY-ROADMAP.md`).
- **P1:** CODEOWNERS teams; plugin timeouts + webhook verifiers; `web/` lockfiles.
- **P2:** keyless signing (SLSA L3); versioned/searchable docs; security dashboard; fuzzing depth.
- **P3:** SOC2 readiness; ISO 27001 alignment; OpenSSF Best Practices badge; Security Champions.

## Success-criteria check
- Evidence-based recommendations ✅ · documented reproducible scoring ✅
  (`SCORING-METHODOLOGY.md`) · industry-framework alignment ✅ (OpenSSF/SLSA/SSDF/ASVS)
  · canonical Trust Center ✅ (`security/TRUST-CENTER.md`) · governance comparable to
  mature OSS ✅ · plugin quality/security documented ✅ · **no breaking changes, no
  `packages/core` runtime edits** ✅ · existing publish/signing/provenance workflows
  unchanged ✅.

## Deliverables (this phase)
`audits/`: REPOSITORY-METRICS, SCORING-METHODOLOGY, OPENSSF-REVIEW, PLUGIN-MATURITY-MATRIX, ENTERPRISE-READINESS-2026.
`security/`: SLSA-ASSESSMENT, NIST-SSDF-MAPPING, OWASP-ASVS-MAPPING, SECURITY-ROADMAP, TRUST-CENTER (canonical), THREAT-MODEL-2026 (expanded).
`governance/`: RELEASE-POLICY, CONTRIBUTOR-GOVERNANCE.
