---
layout:      default
title:       "Authentication"
parent:      "HTMX"
nav_order:   5
permalink:   /htmx/authentication/
description:  "Wire StreetJS sessions and auth to HTMX login/register flows using HX-Redirect and fragment errors."
---

# Authentication

HTMX apps use the same StreetJS [authentication](/StreetJS/authentication/) you'd
use for an API — sessions, JWT, RBAC — but responses are HTML fragments and
client-side redirects via `HX-Redirect`.

## Login flow

```ts
@Post('/login')
async login(ctx: StreetContext) {
  const { email, password } = ctx.body as { email: string; password: string };
  const user = await this.auth.verify(email, password);
  if (!user) {
    ctx.htmx.fragment('<p class="error">Invalid email or password.</p>', 401);
    return;
  }
  await ctx.session.set('userId', user.id);     // server-side session
  ctx.htmx.hx({ redirect: '/dashboard' }).fragment('');  // HX-Redirect
}
```

`HX-Redirect` tells HTMX to navigate the browser — a clean post/redirect/get
without a JSON round-trip.

## Protecting routes

Use the standard StreetJS auth middleware/guards. For HTMX, an unauthenticated
request to a protected page should redirect to `/login`:

```ts
@Get('/dashboard')
@Auth()                       // core guard
async dashboard(ctx: StreetContext) {
  if (!ctx.user) { ctx.htmx.hx({ redirect: '/login' }).fragment(''); return; }
  ctx.htmx.view('dashboard', { title: 'Dashboard', user: ctx.user });
}
```

## Register

Same pattern — validate, create the user (hash via the core vault), start a
session, then `HX-Redirect`. Return field errors as fragments targeted at the
form's error container.

## CSRF

Always include `{{{ csrf }}}` in auth forms — see [Forms & CSRF](/StreetJS/htmx/forms/).

Next: [Realtime](/StreetJS/htmx/realtime/).
