# StreetJS Security Roadmap

> Phased, prioritized security roadmap (P0 critical → P3 long-term). Each item
> links to its evidence/runbook. (This is the *security execution* roadmap; the
> older strategic `plans/SECURITY-ROADMAP.md` is superseded by this for security.)

## P0 — Critical (now)
| Item | Why | Reference |
|---|---|---|
| Branch protection on `main` | Enforces review/required-checks; unlocks SLSA L3 + OpenSSF Branch-Protection | `BRANCH-PROTECTION-REVIEW.md` |
| Push protection + Secret scanning (platform) | Server-side secret block | `OPENSSF-REVIEW.md` |
| Rotate + relocate signing keys | Remove long-lived/on-disk key risk | `KEY-ROTATION-RUNBOOK.md` (rotation done; relocate pending) |
| Purge leaked key blob from history | Remove inert-but-present secret | `KEY-ROTATION-RUNBOOK.md` §7 |

## P1 — High (next)
| Item | Why | Reference |
|---|---|---|
| Outbound HTTP timeouts (9 `node:https` plugins) | Prevent hung-connection DoS | `PLUGIN-SECURITY-REPORT.md` |
| Webhook verifiers (stripe/twilio/paypal/sendgrid) | Authenticity for provider-signed webhooks | `PLUGIN-SECURITY-AUDIT.md` |
| Retry policies + idempotency keys | Resilience without double-effects | `PLUGIN-SECURITY-STANDARD.md` |
| Rate limiting guidance at plugin seams | Abuse control | OWASP ASVS V13 |
| CODEOWNERS teams | Bus-factor / review separation | `CONTRIBUTOR-GOVERNANCE.md` |

## P2 — Medium
| Item | Why |
|---|---|
| Fuzz testing depth / OSS-Fuzz | Beyond current `fuzz-testing` suite |
| Chaos testing expansion | Resilience (suite exists in `system-tests`) |
| Versioned + searchable docs | Enterprise docs parity |
| Security dashboard | Surface Scorecard/alerts centrally |
| Keyless (Sigstore) plugin signing | SLSA L3, no long-lived key |

## P3 — Long-term
| Item | Why |
|---|---|
| SOC 2 readiness | Enterprise procurement |
| ISO 27001 alignment | Enterprise procurement |
| OpenSSF Best Practices badge | Public assurance |
| Security Champions program | Sustained governance |

## Tracking
P0/P1 are also reflected in `plans/REPOSITORY-CLEANUP-PLAN.md` (operator items) and
`audits/PLUGIN-SECURITY-REPORT.md` (runtime items). Progress is measured via
`audits/SCORING-METHODOLOGY.md`.
