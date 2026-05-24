---
layout:    default
title:     "WebSocket & SSE"
parent:    "Realtime"
nav_order: 1
permalink: /realtime/websocket/
---

# WebSocket

street provides a WebSocket server built on the `ws` library with heartbeat management, bounded connections, and full lifecycle cleanup.

---

## Setup

Create the WebSocket server and attach it to the HTTP server:

```typescript
import { StreetWebSocketServer } from './websocket/server.js';

const wsServer = new StreetWebSocketServer({
  heartbeatIntervalMs: 30_000,   // Ping clients every 30 seconds
  maxConnections: 10_000,        // Reject connections beyond this
});

// Register in DI container so controllers can broadcast
container.register(StreetWebSocketServer, wsServer);
```

Attach to the HTTP server after calling `app.listen()`:

```typescript
// The underlying http.Server is not directly exposed, so attach via the upgrade event.
// For full WebSocket integration, pass the raw server:

import { createServer } from 'node:http';
const httpServer = createServer(/* ... */);

wsServer.attach(httpServer, (socket, req) => {
  console.log('New WebSocket connection from', req.socket.remoteAddress);

  socket.on('message', (data) => {
    // data is the parsed payload from the WsEvent frame
    console.log('Received:', data);
  });

  socket.emit('welcome', { message: 'Connected to street WebSocket' });
});
```

---

## Message format

All messages are JSON-serialized `WsEvent` objects:

```typescript
interface WsEvent {
  type: string;     // Event name (e.g., 'chat:message', 'user:created')
  payload: unknown; // Any JSON-serializable value
  ts: number;       // Unix timestamp in milliseconds
}
```

---

## StreetSocket API

Each connection wraps a `WebSocket` in a typed `StreetSocket`:

```typescript
socket.on('chat:message', (data) => {
  const msg = data as { text: string; from: string };
  console.log(`${msg.from}: ${msg.text}`);
});

socket.emit('chat:message', { text: 'Hello!', from: 'server' });
socket.emit('notification', { type: 'info', text: 'User joined' });

socket.close(1000, 'Normal closure');

console.log(socket.closed);      // boolean
console.log(socket.readyState);  // WebSocket.OPEN etc.
```

### Bounded listeners

Each socket allows at most 64 listeners per event type. Registering more throws an error — this prevents listener leak bugs from going undetected:

```typescript
// This throws after 64 registrations:
socket.on('data', handler);
```

---

## Broadcasting

Send a message to every connected client:

```typescript
wsServer.broadcast('system:alert', {
  message: 'Server maintenance in 5 minutes',
  level: 'warning',
});
```

Dead connections are skipped automatically (checked against `WebSocket.OPEN`).

---

## Heartbeat mechanism

The heartbeat runs on `heartbeatIntervalMs` intervals:

1. For each connection: check `ws.isAlive`
2. If `false`: the client did not respond to the last ping — terminate it
3. Set `ws.isAlive = false`
4. Send a `ping` frame

When the client receives a `ping`, it automatically sends a `pong`. The `pong` handler sets `ws.isAlive = true`.

This detects broken TCP connections (e.g., client network loss) that would otherwise linger indefinitely.

---

## Cleanup

```typescript
// Graceful shutdown
await wsServer.close();
// Terminates all open connections, stops heartbeat timer
```

---

## Full chat example

```typescript
import { Injectable } from '../core/container.js';
import { Controller, Get } from '../core/decorators.js';
import type { StreetContext } from '../core/context.js';
import { StreetWebSocketServer } from '../websocket/server.js';

interface ChatMessage {
  text: string;
  from: string;
  room: string;
}

// In-memory room registry (bounded)
const MAX_ROOMS = 100;
const rooms = new Map<string, Set<string>>();  // room → Set<userId>

@Injectable()
@Controller('/api/chat')
export class ChatController {
  constructor(private readonly wsServer: StreetWebSocketServer) {}

  @Get('/rooms')
  async listRooms(ctx: StreetContext): Promise<void> {
    ctx.json({
      rooms: [...rooms.keys()].slice(0, MAX_ROOMS),
      connections: this.wsServer.connectionCount,
    });
  }
}

// WebSocket handler (attached in main.ts)
export function setupChatSocket(wsServer: StreetWebSocketServer): void {
  wsServer.attach(httpServer, (socket) => {
    let userId: string | null = null;
    let currentRoom: string | null = null;

    socket.on('chat:join', (data) => {
      const { room, user } = data as { room: string; user: string };

      if (rooms.size >= MAX_ROOMS && !rooms.has(room)) {
        socket.emit('chat:error', { message: 'Too many rooms' });
        return;
      }

      userId = user;
      currentRoom = room;

      if (!rooms.has(room)) rooms.set(room, new Set());
      rooms.get(room)!.add(userId);

      wsServer.broadcast('chat:joined', { user: userId, room });
    });

    socket.on('chat:message', (data) => {
      if (!userId || !currentRoom) {
        socket.emit('chat:error', { message: 'Not in a room' });
        return;
      }
      const msg = data as { text: string };
      wsServer.broadcast('chat:message', {
        from: userId,
        room: currentRoom,
        text: msg.text.slice(0, 2000),   // Bound message length
        ts: Date.now(),
      });
    });

    socket.on('*', (event) => {
      // Wildcard — runs for every event type
      const { type } = event as { type: string };
      if (type === 'close') {
        if (userId && currentRoom) {
          rooms.get(currentRoom)?.delete(userId);
          if (rooms.get(currentRoom)?.size === 0) rooms.delete(currentRoom);
          wsServer.broadcast('chat:left', { user: userId, room: currentRoom });
        }
      }
    });
  });
}
```

---

# Server-Sent Events

SSE provides a one-directional, long-lived HTTP connection for streaming real-time events to browsers. Unlike WebSocket, SSE is built on plain HTTP — no upgrade handshake, proxy-friendly, and automatically reconnects.

---

## Creating an SSE endpoint

```typescript
import { createSse } from '../websocket/sse.js';

@Get('/events')
async eventStream(ctx: StreetContext): Promise<void> {
  const sse = createSse(ctx.res, 30_000);  // 30-second heartbeat

  // Send an immediate confirmation
  sse.send({ event: 'connected', data: { ts: Date.now() } });

  // Periodic updates
  let seq = 0;
  const interval = setInterval(() => {
    if (sse.closed) { clearInterval(interval); return; }
    sse.send({ event: 'tick', data: { seq: ++seq, ts: Date.now() } });
  }, 5_000);
  interval.unref();

  ctx.res.once('close', () => clearInterval(interval));
}
```

---

## SSE event format

```typescript
sse.send({
  event: 'user:created',       // optional event name (default: 'message')
  data: { id: 'abc', name: 'Alice' },  // any JSON-serializable value
  id: '42',                    // optional client-trackable event ID
  retry: 3000,                 // optional reconnection delay hint (ms)
});
```

Produces the wire format:

```
id: 42
event: user:created
data: {"id":"abc","name":"Alice"}

```

---

## Client-side usage

```javascript
const es = new EventSource('/api/events');

es.addEventListener('user:created', (e) => {
  const user = JSON.parse(e.data);
  console.log('New user:', user.name);
});

es.addEventListener('tick', (e) => {
  const { seq } = JSON.parse(e.data);
  document.title = `Tick #${seq}`;
});

es.onerror = () => {
  console.log('Reconnecting...');  // Browser reconnects automatically
};
```

---

## Heartbeat

`createSse(res, heartbeatMs)` sends a `:ping` comment every `heartbeatMs` milliseconds:

```
:ping

```

SSE comments (lines starting with `:`) are valid protocol messages that browsers receive and silently ignore. The heartbeat keeps the TCP connection alive through proxies and load balancers that close idle connections.

---

## Cleanup

The `SseConnection` cleans itself up automatically:
- On `res.close` (client disconnected)
- On `res.error`
- On `socket.end`

Calling `sse.close()` explicitly ends the response and clears the heartbeat timer. Always clean up intervals:

```typescript
ctx.res.once('close', () => {
  clearInterval(myInterval);
  // sse.closed is already true here — sse.close() was called automatically
});
```

---

## SSE vs WebSocket

| Feature | SSE | WebSocket |
|---|---|---|
| Direction | Server → Client only | Bidirectional |
| Protocol | HTTP/1.1 | Upgrade to ws:// |
| Proxy support | Excellent | Requires proxy config |
| Reconnection | Automatic (browser) | Manual |
| Data format | Text only | Text + binary |
| Use case | Notifications, feeds, logs | Chat, games, collaboration |

Use SSE for push notifications, activity feeds, live dashboards, and progress updates. Use WebSocket when the client also needs to send data (chat, collaborative editing, games).
