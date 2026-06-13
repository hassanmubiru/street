# Example 05 — Live Dashboard

A server pushes periodic metric snapshots to every subscriber of a `metrics`
channel using the realtime `ChannelHub`. Demonstrates server-initiated fan-out
(no client request needed) — the pattern behind live dashboards, status pages,
and activity feeds.

## Run

```bash
npm run build:app -w packages/core
node examples/05-live-dashboard/main.mjs
```

Two dashboard clients subscribe; the server broadcasts three metric ticks; the
example asserts both clients received all three, then exits 0.

## Pattern

```ts
const hub = new ChannelHub();
wss.attach(http, (socket, req) => { hub.bind(socket); hub.join('metrics', userId, socket); });

// elsewhere (timer, DB change, queue consumer):
hub.publish('metrics', 'metric', { cpu, rps });   // reaches all subscribers
```

For multiple server instances, fan `publish` through a shared pub/sub (e.g.
Redis) so updates reach subscribers on every node.
