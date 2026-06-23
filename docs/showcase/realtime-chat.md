---
layout:      default
title:       "Realtime Chat — built with StreetJS"
permalink:   /showcase/realtime-chat/
nav_exclude: true
description:  "A production-shaped realtime chat backend built with StreetJS — authenticated WebSockets, rooms, presence, typing, history."
---

# Realtime Chat — built with StreetJS

**WebSockets · Presence · Channels — authenticated, bounded, benchmarked.**

- **Live demo:** _coming soon_ (WebSocket-capable host — see the [demo plan](https://github.com/hassanmubiru/StreetJS/blob/main/DEMO-INFRA-PLAN.md))
- **Source:** [`examples/reference-apps/realtime-chat`](https://github.com/hassanmubiru/StreetJS/tree/main/examples/reference-apps/realtime-chat)
- **Deploy:** [`deploy/helm/street`](https://github.com/hassanmubiru/StreetJS/tree/main/deploy) · **Docs:** [Realtime channels](/StreetJS/realtime-channels/)

## Architecture

```
Client ──WS upgrade + JWT auth──▶ StreetWebSocketServer
                                     └─ ChannelHub: rooms · presence · typing · history
                                          (bounded connections, heartbeat, 512 KB frame cap)
                                          └─ (scale-out) optional Redis pub/sub in front of ChannelHub
```

Auth runs **at the upgrade** — unauthenticated sockets are rejected before the
connection is established (verified by the smoke test). `ChannelHub` provides
rooms, reference-counted presence, typing indicators, and a bounded per-room
history buffer.

## Run it locally

```bash
npm run build -w packages/core
node examples/reference-apps/realtime-chat/server.mjs        # :3000
node examples/reference-apps/realtime-chat/smoke-test.mjs    # 8/8 checks
```

Client frames: `join`, `leave`, `message`, `typing`. Server emits
`presence:snapshot`, `history`, `presence:join/leave`, `typing`, `message`.

## Performance (MEASURED — relative, in-memory single instance)

10 subscribers × 2000 messages → 20,000/20,000 delivered in ~0.18s
(~115K deliveries/s). Horizontal scale needs a Redis pub/sub fan-out in front of
`ChannelHub.publish` and a Postgres-backed history store.

## Learning path

1. WebSocket basics
2. Channels & presence
3. **Realtime chat**
4. [Multiplayer](/StreetJS/showcase/) — low-latency state sync

> A real, CI-tested reference app. Browse all demos in the
> [Showcase](/StreetJS/showcase/).
