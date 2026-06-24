# StreetJS Security Scorecard — 2026

> A point-in-time, evidence-based scoring of the security posture from
> `SECURITY-AUDIT-2026.md`. Scores are 0–100 per dimension with a weighted
> composite. "Current" reflects verified source state today; "Target" is the
> posture after the `SECURITY-ROADMAP.md` quick wins + medium improvements.
> Scores are judgments grounded in the findings, not a certification.

## Composite

| | Score | Band |
|---|------:|------|
| **Current composite** | **78 / 100** | Secure open-source framework |
| **Target composite (post-roadmap)** | **91 / 100** | Enterprise-ready posture |

Weighted composite = mean of the dimension scores below (equal weight).

## Dimensions

| Dimension | Current | Target | Rationale (current) | Gap to target |
|---|------:|------:|---|---|
| **Cryptography & primitives** | 92 | 95 | JWT/sessions/CSRF/MFA/vault all use `node:crypto` with `timingSafeEqual`, AES-256-GCM, scrypt; RFC-vector-tested MFA. | Minor: session rotation/revocation. |
| **Authentication** | 84 | 93 | MFA + OAuth2 PKCE + strong tokens. Cookie flags opt-in (F-A1); no session revocation (F-A3). | Secure-by-default cookies; optional revocation. |
| **Authorization / multi-tenancy** | 80 | 92 | `orgScopedRepo` tenant isolation proven by property tests. Realtime channels lack authz (F-R5); webhook→org binding mapping-derived (F-PAY5). | Channel authz; event-bound tenant. |
| **Realtime security** | 60 | 88 | Frame cap + global conn cap + SSE sanitization. But auth optional (F-R1), no Origin check (F-R2), no per-IP RL (F-R3), no payload schema (F-R4). | Default auth/origin, rate limit, validation. |
| **Payments** | 78 | 92 | Stripe overlay = signature + 300s replay window + idempotency + atomic tx (strong). MarzPay overlay lacks idempotency/replay (F-PAY1/2); Stripe store migration missing (F-PAY4). | MarzPay idempotency; ship migrations. |
| **Plugin system / signing** | 72 | 90 | Ed25519 signing + 21/21 official signed + permission grants. Verification opt-in (F-P1); declarative (not runtime) sandbox (F-P2); no manifest schema (F-P3); TOCTOU (F-P4). | Default-verify, manifest schema, freeze, honest docs (+ isolation later). |
| **Supply chain** | 90 | 94 | Provenance + cosign + SBOM + dep-review + secret-scan + signed plugins + 3 deps. | Key rotation/keyless (F-SC1). |
| **Infrastructure / CI-CD** | 88 | 92 | Protected `main`, SHA-pinned + zizmor-linted Actions, least-privilege perms, secret scanning. | Bus factor 1 (F-CI1). |
| **Input validation** | 85 | 90 | Zod-backed `@Validate`, XSS sanitizer, parameterized SQL. WS frames unvalidated (F-R4); ORM sweep pending (F-ORM1). | WS validation; injection sweep. |
| **AI security** | 55 | 80 | Not source-verified this pass (F-AI1) — RAG + tool-calling present, guardrails unconfirmed. | Dedicated AI review. |

## Severity tally (confirmed findings)

| Severity | Count |
|---|---|
| CRITICAL | 0 |
| HIGH | 4 (F-R1, F-R2, F-P1, F-PAY1) |
| MEDIUM | 10 |
| LOW | 5 |
| INFORMATIONAL | 2 |

## Trajectory to "enterprise-ready"

1. **Quick wins (<1 day)** lift Realtime (60→~78), Auth (84→~90), Plugins (72→~80), Payments (78→~85) → composite ≈ **84**.
2. **Medium (<1 week)** close the HIGH realtime/plugin/payment gaps + AI review + ORM sweep → composite ≈ **91** (target).
3. **Major (<1 month)** — real plugin isolation, session revocation, key rotation, second maintainer, and an **external security review + pen-test** — move toward **95+** and convert documentation-grade compliance into audited evidence.

## Method & honesty notes

- Scores derive from confirmed source findings; no dimension is inflated. AI scores low because it was **not** deeply audited this pass (stated, not penalized as if broken).
- Stripe/PayPal plugin internals are out of repo and excluded from the Payments crypto judgment (only the in-repo overlays + MarzPay are scored).
- The composite is a planning instrument, not a certificate; "enterprise-ready" is gated on the external review (initiative #22).
