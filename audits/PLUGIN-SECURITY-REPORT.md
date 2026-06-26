# StreetJS Plugin Security Report (Phase 9)

> Code-safety + baseline audit of all 21 official `@streetjs/plugin-*` packages.
> Read-only, evidence-based. Complements `security/PLUGIN-SECURITY-AUDIT.md`
> (per-control matrix) and `security/PLUGIN-SECURITY-STANDARD.md` (the baseline).

## Dangerous-construct scan (VERIFIED across `packages/plugin-*/src`, excl. tests)

| Construct | Hits | Result |
|---|---|---|
| `eval(` | 0 | ✅ none |
| `new Function(` | 0 | ✅ none |
| `child_process` | 0 | ✅ none |
| `execSync` / `execFile` / `spawn(` | 0 | ✅ none |
| `: any` / `as any` / `<any>` | 0 | ✅ strict typing — no `any` escapes |
| arbitrary file writes (`writeFileSync`/`createWriteStream`) | 0 | ✅ none |
| shell execution / arbitrary dynamic import | 0 | ✅ none |

No plugin executes shells, evaluates code, spawns processes, writes arbitrary
files, or weakens the type system. This is a strong, uniform result.

## Baseline checklist (per `PLUGIN-SECURITY-STANDARD.md`)

| Control | Status |
|---|---|
| No secrets / no hardcoded production endpoints | ✅ creds from config/env only; hosts hardcoded to provider or https-validated |
| Strict TS (no `any`) | ✅ (scan above) |
| Manifest signing (Ed25519, matches official anchor `3ae9add0`) | ✅ all 21 |
| Required files (README/package.json/manifest.json/manifest.signed.json/manifest.pub/LICENSE/SECURITY.md) | ✅ all 21 (LICENSE added this sprint) |
| Credential redaction / no secret logging | ✅ no `console`/logger of secrets |
| Input validation | ✅ field validators throw `PluginError` before I/O; percent-encoding on path segments |
| Webhook verification | ◑ marzpay/africastalking fail-closed + re-verify (provider has no scheme); **stripe/twilio/paypal/sendgrid verifiers are a known gap** |
| HTTP timeout | ◑ marzpay/africastalking ✅; **9 `node:https` plugins lack timeouts (gap)** |
| Retry / idempotency | ◑ africastalking bounded retry; marzpay overlay idempotency; others rely on caller |
| Dependency safety | ✅ "dependency-free" design — wire-protocol clients over Node core; Dependabot + `dependency-review.yml` |

## Per-focus-plugin notes
- **MarzPay (88/100):** reference implementation — fail-closed webhooks + server re-verify, atomic idempotency, server-derived tenant binding, timeout, no secret logging, ~97% branch coverage, 10 PBTs. Detail in `security/MARZPAY-SECURITY-REVIEW.md`.
- **Africa's Talking (80):** AbortController timeout + bounded retry/backoff; shared-secret callback verify (provider unsigned).
- **HTMX (76):** auto HTML-escaping, CSRF helper, bounded partial depth; raw `{{{ }}}` is by-design; template-name `..` traversal is a developer-trust note.
- **Stripe (66):** no `Stripe-Signature` verifier, no outbound timeout — top remediation target.
- **`@streetjs/plugin-auth`:** does not exist; identity is `plugin-auth0` / `plugin-clerk` (+ `auth-ui`).

## Recommendations (priority)
1. Add outbound timeouts to the 9 `node:https` plugins (stripe, paypal, twilio, sendgrid, auth0, clerk, firebase, supabase, openai).
2. Ship webhook-signature verifiers for stripe + twilio (then paypal, sendgrid).
3. Add SSRF host allow-list/validation for configurable-host plugins.

> Items 1–3 are framework/plugin *runtime* changes — out of scope for this
> governance pass (which must not modify `packages/core` and focuses on
> organization/security controls). They are tracked here for a dedicated change.
