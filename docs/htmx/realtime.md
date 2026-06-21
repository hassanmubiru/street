---
layout:      default
title:       "Realtime"
parent:      "HTMX"
nav_order:   6
permalink:   /htmx/realtime/
description:  "Live HTMX updates over StreetJS WebSockets and SSE — render HTML fragments on the server and swap them on the client."
---

# Realtime

HTMX can subscribe to live updates over WebSockets or Server-Sent Events. With
StreetJS the key idea is: **render HTML fragments on the server and push them** —
the client just swaps them in. No client-side JSON-to-DOM code.

## WebSockets

HTMX's `ws` extension connects to a socket and swaps incoming HTML:

```html
<div hx-ext="ws" ws-connect="/ws">
  <ul id="messages"></ul>
  <form ws-send><input name="msg" autocomplete="off"></form>
</div>
```

Server side, StreetJS already ships a bounded WebSocket server with heartbeat and
auth-on-upgrade. Broadcast rendered partials (not JSON) to subscribers:

```ts
// when a message arrives, render the partial and broadcast HTML
const html = engine.partial('message', { user, body });
hub.broadcast('room:1', `<ul id="messages" hx-swap-oob="beforeend">${html}</ul>`);
```

`hx-swap-oob` lets a pushed fragment update a target by id, out of band.

## Server-Sent Events (SSE)

For one-way streams (notifications, live dashboards), SSE is simpler and reuses
core SSE:

```html
<div hx-ext="sse" sse-connect="/events" sse-swap="notification">…</div>
```

```ts
@Get('/events')
async events(ctx: StreetContext) {
  const sse = ctx.sse();                       // core SSE helper
  timer.on('tick', () => sse.send('notification', engine.partial('toast', data)));
}
```

## Recommended architecture

- Initial page: a normal `ctx.htmx.view(...)` render.
- Live updates: WebSockets for bidirectional (chat), SSE for one-way (dashboards).
- Always send **HTML**, not JSON — HTMX swaps it directly.
- Multi-instance fan-out: add [`@streetjs/plugin-redis`](/StreetJS/plugins/redis/).

See the core [Realtime](/StreetJS/realtime/) guide for the WebSocket/SSE APIs.

Next: [Deployment](/StreetJS/htmx/deployment/).
