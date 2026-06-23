# Maintainers

This file is the roster referenced by [`GOVERNANCE.md`](GOVERNANCE.md). It lists
the people with merge/release authority and records the project's current
governance state honestly.

## Current maintainers

| Maintainer | GitHub | Areas (per `.github/CODEOWNERS`) |
|------------|--------|----------------------------------|
| StreetJS lead | [@hassanmubiru](https://github.com/hassanmubiru) | All paths; security, database, and `.github/` are explicitly owned |

## Honest governance status (bus factor)

> **The project currently has one maintainer (bus factor = 1).** This is the
> top organizational risk on the [Go-To-Market Roadmap](docs/adoption/go-to-market-roadmap.md),
> and onboarding a second maintainer is the single highest-priority action.

Because of this, several parts of `GOVERNANCE.md` are **documented but not yet
operational**, and activate only once the maintainer base grows:

- **Steering Committee** — requires an **odd number of seats (≥ 3)** held by
  Maintainers. It activates at **N ≥ 3 maintainers**; until then, decisions are
  made by the sole maintainer under the documented RFC and contribution rules.
- **Maintainer elections, FCP votes, and two-maintainer moderation concurrence**
  — likewise activate at N ≥ 2/3 as written in `GOVERNANCE.md`.

This means triage windows, review SLAs, and mentorship cadence are **best-effort**
today, not guarantees.

## Becoming a maintainer

The contributor ladder (first-time → recurring contributor → reviewer →
maintainer → Steering Committee) is documented in
[`docs/community/contributor-path.md`](docs/community/contributor-path.md).
Maintainer nomination follows the criteria there and in `GOVERNANCE.md`. If you
are interested in helping carry the project, open a
[Discussion](https://github.com/hassanmubiru/StreetJS/discussions) — reducing the
bus factor is actively wanted.
