---
layout: default
title: "README Modernization & Documentation Audit"
nav_exclude: true
permalink: /README-AUDIT/
description: "Evidence-based audit of the StreetJS GitHub and npm READMEs, with SEO recommendations, a link-validation report, and a conversion-optimization roadmap."
---

# README Modernization & Documentation Audit

> Evidence-based. Claims tagged **VERIFIED** (checked against the repo / npm / live
> site on 2026-06-17), **INFERRED** (reasoned from evidence), or **UNKNOWN** (no
> signal). The rewritten READMEs themselves are the repo `README.md` and
> `packages/core/README.md` — this document is the audit + strategy that produced them.

---

## Part 1 — Audit of the previous state

### Findings

| # | Finding | Class |
|---|---|---|
| 1 | Root README stated **"two carefully chosen dependencies"** and **"No Zod"**, but `packages/core` ships **three** deps (`reflect-metadata`, `ws`, `zod`) — `zod` is now used for runtime validation | **CRITICAL** (VERIFIED) |
| 2 | Root README said the repo contains **"two packages"**; it is a **47-package** monorepo with 19 official plugins, an ORM, and frontend SDKs | **CRITICAL** (VERIFIED) |
| 3 | No comparison table vs Express / Fastify / NestJS | IMPROVEMENT (VERIFIED) |
| 4 | No "What problem does it solve?" / value-proposition section — README opened straight into install | IMPROVEMENT (VERIFIED) |
| 5 | No Official Plugins section despite 19 signed plugins shipping | IMPROVEMENT (VERIFIED) |
| 6 | No consolidated Security & Supply-Chain section (signing, provenance, SBOM, CodeQL, secret-scan, Scorecard, runtime cert all exist but weren't surfaced) | IMPROVEMENT (VERIFIED) |
| 7 | Badge quality: several CI badges used `?job=` query params that GitHub's badge endpoint does not render reliably; effectively decorative | IMPROVEMENT (VERIFIED) |
| 8 | Root README was **CLI-manual-heavy** (~400+ lines of command reference) — duplicated the docs site and buried the value prop; weak for first impressions and mobile readability | IMPROVEMENT (VERIFIED) |
| 9 | Deep doc links used repo-relative `docs/*.md` paths only — fine on GitHub, but missed the chance to drive traffic to the docs site | IMPROVEMENT (VERIFIED) |
| 10 | npm README was accurate on deps (3) and structurally solid, but ~450 lines with exhaustive per-module snippets — long for an npm package page | IMPROVEMENT (VERIFIED) |
| 11 | Trust signals (provenance, Scorecard, SBOM) present in the repo but under-communicated in both READMEs | IMPROVEMENT (VERIFIED) |
| 12 | No hero logo / centered hero block; no one-line value proposition above the fold | IMPROVEMENT (VERIFIED) |

### What was already good (VERIFIED)

- Accurate, runnable quick-start examples in both files.
- npm README already correct about the 3 dependencies and `NodeNext` tsconfig.
- License, Discussions, Issues, Security policy links present.
- OpenSSF Scorecard and npm version/downloads badges already working.

---

## Part 2 & 3 — Rewritten READMEs (delivered)

- **GitHub README** → `README.md`: centered hero with logo + one-line value prop + working badges (npm version/downloads, license, CI, CodeQL, Scorecard, provenance, Node, TS); "What is StreetJS?" (dependency sprawl / integration complexity / supply-chain risk / infra cost / time-to-production); Why-StreetJS comparison table; Quick Start (`npx @streetjs/cli create` + `npm install`); Features (Core/Data/Security/Realtime/AI/DevOps/Ecosystem); Official Plugins by category; Security & Supply Chain; Documentation table; Community; Monorepo; MIT license.
- **npm README** → `packages/core/README.md`: **208 lines** (target < 400, VERIFIED). Install-first → quick start → scaffold → tsconfig → concise feature summary → essentials → exports → env table → doc links. Marketing trimmed.

Both corrected the dependency count (3) and package count (47).

---

## Part 4 — SEO recommendations

### GitHub (VERIFIED current state)
- **Repository description** — already set and descriptive. ✅
- **Topics** — 20 topics set, including `streetjs`, `typescript-framework`, `backend-framework`, `nodejs`, `api-framework`, `orm`, `realtime`, `self-hosted`, `websockets`, `openapi`, `postgresql`. ✅ (covers the high-value keyword set).
- **Social preview image** — **UNKNOWN / action needed:** set a 1280×640 social preview in repo Settings → Social preview (the docs `og.png` at 1200×630 can be adapted). GitHub does not expose this via API/CLI, so it must be set in the web UI.
- **README keyword placement** — the new README leads with "TypeScript backend framework" in the H1/subtitle and repeats target phrases in the value-prop and comparison sections (natural density, not stuffed).

### npm — `keywords` field (VERIFIED present)
`packages/core/package.json` already includes a strong keyword set (`typescript`, `framework`, `backend`, `nodejs`, `rest-api`, `postgresql`, `websocket`, `openapi`, `microservices`, `real-time`, `security`, …). Recommended additions to match high-intent search phrases: **`backend-framework`**, **`web-framework`**, **`api-framework`**, **`realtime-framework`**, **`self-hosted`**, **`orm`**. (INFERRED value — npm search weights name/keywords/description.)

---

## Part 5 — Link validation report

Live HTTP status checked against `https://hassanmubiru.github.io/street/` on 2026-06-17 (VERIFIED). Repo-relative links (`LICENSE`, `SECURITY.md`, `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `GOVERNANCE.md`) were confirmed to exist as files in the repo root.

| Link | Status | Recommendation |
|---|---|---|
| `/` (docs home) | 200 ✅ | Use as primary docs link |
| `/getting-started/` | 200 ✅ | Keep |
| `/tutorials/` | 200 ✅ | Keep |
| `/examples/` | 200 ✅ | Keep |
| `/plugins/` | 200 ✅ | Keep |
| `/plugins-official/` | 200 ✅ | **Fixed in this pass** — added pretty permalink (was `.html` only) |
| `/ecosystem/plugin-author-guide/` | 200 ✅ | Keep |
| `/ecosystem/plugin-certification/` | 200 ✅ | Keep |
| `/security/` | 200 ✅ | Keep |
| `/enterprise/` | 200 ✅ | Keep |
| `/compare/` | 200 ✅ | Keep |
| `/roadmap/` | 200 ✅ | Keep |
| `/faq/` | 200 ✅ | Keep |
| `/database/` | 200 ✅ | Keep |
| `/runtime-certification/` | 200 ✅ | Keep |
| `/adoption/go-to-market-roadmap/` | 200 ✅ | Keep |
| `/STREETJS-GAP-ANALYSIS/` | 200 ✅ | Keep |
| `/deployment/budget/` | 200 ✅ | Keep |
| `/changelog/` (site) | 200 ✅ | README links the repo `CHANGELOG.md` instead (canonical) |
| `/ecosystem/` (index) | 404 ⚠️ | No index page — README links the two subpages directly (avoided) |
| `@streetjs/orm` (npm) | 200 ✅ | Keep |
| `LICENSE`, `SECURITY.md`, `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `GOVERNANCE.md` (repo) | exist ✅ | Repo-relative links resolve on GitHub |

No broken links remain in the rewritten READMEs.

---

## Part 6 — Conversion optimization roadmap

### High impact
- **Above-the-fold clarity (done):** logo + one-line value prop + Get-Started CTA answers "what is this / why care / how to start" in seconds — the biggest lever on stars and npm conversion. (IMPLEMENTED)
- **Comparison table (done):** "NestJS alternative"-style intent converts; the table gives a reason to switch. (IMPLEMENTED)
- **Set the GitHub social preview image** (action needed, web UI): drives click-through when the repo is shared on social/Slack/Discord. (UNKNOWN until set)
- **Republish `streetjs` to surface the new npm README** — the npm page only updates on publish; the leaner README improves the npm package-page conversion. (INFERRED)

### Medium impact
- **Add `backend-framework` / `api-framework` / `self-hosted` to npm `keywords`** for search reach.
- **Pin the "Introducing StreetJS" Discussion** and link it from the README community section to seed participation.
- **Tutorial CTAs:** the README links `/tutorials/`; ensure the beginner tutorials (Todo, REST API) are complete to convert first-time visitors into builders.

### Low impact
- Add a short animated terminal/GIF of `street create` → `street dev` (visual proof; nice-to-have).
- Add a "Used by / Showcase" section once real deployments exist (do **not** fabricate — leave out until verifiable).

---

## Deliverables checklist

| Deliverable | Location |
|---|---|
| README audit report | this document (§1) |
| Production-ready GitHub README | `README.md` |
| Production-ready npm README | `packages/core/README.md` |
| SEO recommendations | §4 |
| Link validation report | §5 |
| Conversion optimization roadmap | §6 |
