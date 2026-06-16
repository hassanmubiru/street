---
layout:    default
title:     "StreetJS vs Auth0"
parent:    "Compare"
nav_order: 8
permalink: /compare/streetjs-vs-auth0/
description: "StreetJS vs Auth0 — self-hosted, built-in authentication versus a managed identity service. StreetJS ships JWT, sessions, RBAC, and MFA you own and run; Auth0 is a hosted IdP with broad integrations and compliance."
---

# StreetJS vs Auth0

**In one line:** This is a build-and-self-host vs buy-managed decision. Auth0 is a
managed identity provider you integrate with; StreetJS ships authentication (JWT,
sessions, RBAC, MFA) as built-in primitives you own and run yourself — and can
still integrate Auth0 via a plugin if you prefer the managed route.

> **Not a like-for-like comparison.** Auth0 is a hosted identity *service*;
> StreetJS is a backend *framework*. They overlap on the auth layer, which is what
> this page compares.

---

## At a glance

| | StreetJS (built-in auth) | Auth0 |
|---|---|---|
| Model | Self-hosted primitives in your app | Managed, hosted identity provider |
| JWT / sessions | Built in (AES-256-GCM sessions) | Issued and managed by Auth0 |
| RBAC | Built in | Roles & permissions (managed) |
| MFA | Built in | Built in (broad factor support) |
| Social / enterprise SSO | DIY or via plugins | Extensive out of the box (OIDC, SAML, social) |
| Where data lives | Your database | Auth0 tenant |
| Cost model | Your infra cost | Per-MAU subscription |
| Compliance certifications | Your responsibility | SOC 2, ISO, etc. provided |
| Vendor lock-in | None | Migration effort to leave |

---

## Where Auth0 wins

- **Breadth of identity features** out of the box: dozens of social/enterprise
  connectors, OIDC/SAML SSO, anomaly detection, and a hosted login UI.
- **Compliance offload.** SOC 2 / ISO certifications and security operations are
  handled for you.
- **Less to build and maintain** — identity is a deep domain; Auth0 covers edge
  cases you'd otherwise own.

## Where StreetJS wins

- **You own the data and the cost curve.** No per-MAU pricing; auth runs inside
  your app against your database.
- **No third-party dependency or lock-in** for core auth flows.
- **Integrated with the rest of your backend** — guards, RBAC, and sessions are
  part of the same typed framework, not an external round-trip.

## Honest tradeoffs

If you need enterprise SSO, a hosted login experience, broad social connectors, or
compliance certifications handled for you, Auth0 saves significant time and risk.
If you want to avoid per-MAU costs and vendor lock-in, keep identity data in your
own database, and you're comfortable owning auth, StreetJS's built-in primitives
are a strong fit. You can also use the **[`@streetjs/plugin-auth0`](/plugins/)**
integration to combine StreetJS with Auth0 if you want both.

---

## FAQ

**Can StreetJS replace Auth0 entirely?**
For many apps, yes — JWT, sessions, RBAC, and MFA are built in. But Auth0's hosted
SSO, social connectors, and compliance offload are not something a framework
replaces for free; you'd build and operate those yourself.

**Can I use StreetJS with Auth0?**
Yes. StreetJS can validate Auth0-issued tokens and there is an Auth0 plugin, so you
can adopt the managed IdP while still using StreetJS for the rest of your backend.

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "FAQPage",
  "mainEntity": [
    {"@type": "Question", "name": "Can StreetJS replace Auth0 entirely?", "acceptedAnswer": {"@type": "Answer", "text": "For many applications, yes: JWT, sessions, RBAC, and MFA are built in. Auth0's hosted SSO, social connectors, and compliance certifications are not replaced for free; you would build and operate those yourself."}},
    {"@type": "Question", "name": "Can I use StreetJS together with Auth0?", "acceptedAnswer": {"@type": "Answer", "text": "Yes. StreetJS can validate Auth0-issued tokens and offers an Auth0 plugin, so you can use the managed identity provider while StreetJS handles the rest of your backend."}}
  ]
}
</script>
