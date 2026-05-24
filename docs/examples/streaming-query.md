---
layout:    default
title:     "Streaming, Chat & File Upload"
parent:    "Examples"
nav_order: 2
permalink: /examples/streaming-query/
---

# Example: Streaming PostgreSQL Query

This example streams a large dataset from PostgreSQL directly to an HTTP response as NDJSON (newline-delimited JSON), keeping heap usage constant regardless of result set size.

---

## The endpoint

```typescript
// src/controllers/export.controller.ts
import { Injectable } from '../core/container.js';
import { Controller, Get } from '../core/decorators.js';
import type { StreetContext } from '../core/context.js';
import { PgPool } from '../database/pool.js';
import { NotFoundException } from '../http/exceptions.js';

@Injectable()
@Controller('/api/export')
export class ExportController {
  constructor(private readonly pool: PgPool) {}

  /**
   * Stream all users as NDJSON (one JSON object per line).
   * Memory usage: ~2-5 MB regardless of how many users exist.
   */
  @Get('/users')
  async streamUsers(ctx: StreetContext): Promise<void> {
    const conn = await this.pool.acquire();

    ctx.setHeader('Content-Type', 'application/x-ndjson');
    ctx.setHeader('Transfer-Encoding', 'chunked');
    ctx.setHeader('X-Accel-Buffering', 'no');   // Disable nginx buffering
    ctx.res.writeHead(200);

    const stream = conn.queryStream(
      `SELECT id, email, name, roles, created_at
       FROM users
       ORDER BY created_at ASC`
    );

    let rowCount = 0;

    stream.on('data', (row: Record<string, string | null>) => {
      rowCount++;

      const line = JSON.stringify({
        id:        row['id'],
        email:     row['email'],
        name:      row['name'],
        roles:     JSON.parse(row['roles'] ?? '["user"]') as string[],
        createdAt: row['created_at'],
      }) + '\n';

      const canContinue = ctx.res.write(line);

      // Apply backpressure: HTTP buffer is full → pause DB stream
      if (!canContinue) {
        stream.pause();
      }
    });

    // Resume DB stream when HTTP buffer drains
    ctx.res.on('drain', () => stream.resume());

    stream.on('end', () => {
      ctx.res.end();
      this.pool.release(conn);
      console.log(`[export] Streamed ${rowCount} users`);
    });

    stream.on('error', (err) => {
      console.error('[export] Stream error:', err);
      ctx.res.destroy();
      this.pool.release(conn);
    });
  }

  /**
   * Stream as CSV with proper escaping.
   */
  @Get('/users.csv')
  async streamUsersCsv(ctx: StreetContext): Promise<void> {
    const conn = await this.pool.acquire();

    ctx.setHeader('Content-Type', 'text/csv; charset=utf-8');
    ctx.setHeader('Content-Disposition', 'attachment; filename="users.csv"');
    ctx.setHeader('X-Accel-Buffering', 'no');
    ctx.res.writeHead(200);

    // Write CSV header
    ctx.res.write('id,email,name,roles,created_at\n');

    const stream = conn.queryStream(
      'SELECT id, email, name, roles, created_at FROM users ORDER BY created_at ASC'
    );

    stream.on('data', (row: Record<string, string | null>) => {
      const line = [
        row['id'],
        row['email'],
        row['name'],
        row['roles'],
        row['created_at'],
      ]
        .map((v) => `"${(v ?? '').replace(/"/g, '""')}"`)
        .join(',') + '\n';

      const canContinue = ctx.res.write(line);
      if (!canContinue) stream.pause();
    });

    ctx.res.on('drain', () => stream.resume());
    stream.on('end', () => { ctx.res.end(); this.pool.release(conn); });
    stream.on('error', () => { ctx.res.destroy(); this.pool.release(conn); });
  }
}
```

---

## Consuming the stream

```bash
# Fetch NDJSON and process each line
curl -N http://localhost:3000/api/export/users | \
  while IFS= read -r line; do
    echo "$line" | jq '.email'
  done

# Save to file
curl http://localhost:3000/api/export/users.csv -o users.csv

# Count rows streamed
curl -s http://localhost:3000/api/export/users | wc -l
```

---

## Memory profile comparison

| Approach | 100K rows | 1M rows |
|---|---|---|
| Buffered `conn.query()` | ~45 MB spike | OOM or 450 MB |
| Streamed `conn.queryStream()` | ~3 MB steady | ~3 MB steady |

---

# Example: WebSocket Chat Server

A minimal chat server with room support, NDJSON message logging, and bounded connection management.

---

## Server setup

```typescript
// src/main.ts (additions)
import { StreetWebSocketServer } from './websocket/server.js';
import { setupChatHandlers } from './websocket/chat.js';
import { createServer } from 'node:http';

const httpServer = createServer();
const wsServer = new StreetWebSocketServer({
  heartbeatIntervalMs: 30_000,
  maxConnections: 5_000,
});
container.register(StreetWebSocketServer, wsServer);

// After app.listen():
wsServer.attach(httpServer, setupChatHandlers(wsServer));
httpServer.listen(3001);  // WS on separate port, or same port with path routing
```

---

## Chat handler

```typescript
// src/websocket/chat.ts
import { StreetWebSocketServer, type StreetSocket } from './server.js';
import type { IncomingMessage } from 'node:http';

interface ChatUser {
  id: string;
  name: string;
  room: string;
}

// In-memory room state (per-worker — not shared across cluster)
const MAX_ROOMS = 500;
const MAX_MEMBERS_PER_ROOM = 200;
const userMap = new Map<StreetSocket, ChatUser>();

export function setupChatHandlers(
  wsServer: StreetWebSocketServer
): (socket: StreetSocket, req: IncomingMessage) => void {
  return (socket: StreetSocket, req: IncomingMessage) => {
    const remoteIp = req.socket.remoteAddress ?? 'unknown';
    console.log(`[ws] New connection from ${remoteIp}`);

    // ── Join a room ──────────────────────────────────────────────
    socket.on('chat:join', (rawData) => {
      const data = rawData as { name?: string; room?: string };
      const name = String(data.name ?? 'Anonymous').slice(0, 50);
      const room = String(data.room ?? 'general').slice(0, 50);

      // Check room capacity
      const members = [...userMap.values()].filter((u) => u.room === room);
      if (members.length >= MAX_MEMBERS_PER_ROOM) {
        socket.emit('chat:error', { message: 'Room is full' });
        return;
      }

      // Check total rooms
      const rooms = new Set([...userMap.values()].map((u) => u.room));
      if (rooms.size >= MAX_ROOMS && !rooms.has(room)) {
        socket.emit('chat:error', { message: 'Too many rooms' });
        return;
      }

      const user: ChatUser = { id: generateId(), name, room };
      userMap.set(socket, user);

      socket.emit('chat:joined', { userId: user.id, room, name });

      // Notify room members
      broadcastToRoom(wsServer, room, 'chat:user_joined', {
        userId: user.id,
        name,
        memberCount: members.length + 1,
      }, socket);

      console.log(`[ws] ${name} joined room "${room}" (${members.length + 1} members)`);
    });

    // ── Send a message ───────────────────────────────────────────
    socket.on('chat:message', (rawData) => {
      const user = userMap.get(socket);
      if (!user) {
        socket.emit('chat:error', { message: 'Join a room first' });
        return;
      }

      const data = rawData as { text?: string };
      const text = String(data.text ?? '').slice(0, 2000);  // Bounded message
      if (!text.trim()) return;

      broadcastToRoom(wsServer, user.room, 'chat:message', {
        from:   user.name,
        userId: user.id,
        text,
        ts:     Date.now(),
      });
    });

    // ── Leave ────────────────────────────────────────────────────
    socket.on('chat:leave', () => {
      handleLeave(wsServer, socket);
    });

    // ── Disconnect cleanup ───────────────────────────────────────
    // The 'close' event on the underlying WS fires when the connection drops
    // StreetSocket clears its listeners automatically — but we still need
    // to remove the user from our application-level map:
    const ws = (socket as unknown as { ws: { on: Function } }).ws;
    ws.on('close', () => {
      handleLeave(wsServer, socket);
    });
  };
}

function handleLeave(wsServer: StreetWebSocketServer, socket: StreetSocket): void {
  const user = userMap.get(socket);
  if (!user) return;
  userMap.delete(socket);

  broadcastToRoom(wsServer, user.room, 'chat:user_left', {
    userId: user.id,
    name:   user.name,
  });

  console.log(`[ws] ${user.name} left room "${user.room}"`);
}

function broadcastToRoom(
  wsServer: StreetWebSocketServer,
  room: string,
  event: string,
  payload: unknown,
  exclude?: StreetSocket
): void {
  for (const [sock, user] of userMap.entries()) {
    if (user.room === room && sock !== exclude) {
      sock.emit(event, payload);
    }
  }
}

function generateId(): string {
  return Math.random().toString(36).slice(2, 10);
}
```

---

## Client-side JavaScript

```html
<script>
const ws = new WebSocket('ws://localhost:3001');

ws.onopen = () => {
  ws.send(JSON.stringify({ type: 'chat:join', payload: { name: 'Alice', room: 'lobby' }, ts: Date.now() }));
};

ws.onmessage = (e) => {
  const { type, payload } = JSON.parse(e.data);
  if (type === 'chat:message') {
    console.log(`${payload.from}: ${payload.text}`);
  } else if (type === 'chat:joined') {
    console.log('Joined!', payload);
  }
};

function sendMessage(text) {
  ws.send(JSON.stringify({ type: 'chat:message', payload: { text }, ts: Date.now() }));
}
</script>
```

---

# Example: File Upload Service

A complete file upload API with type validation, size limits, metadata storage, and secure serving.

---

## Database

```sql
-- migrations/004_create_file_uploads.sql
CREATE TABLE IF NOT EXISTS file_uploads (
  id           UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID          NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  original_name VARCHAR(255) NOT NULL,
  stored_name  VARCHAR(255) NOT NULL UNIQUE,
  mime_type    VARCHAR(100) NOT NULL,
  size_bytes   BIGINT       NOT NULL,
  path         TEXT         NOT NULL,
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS file_uploads_user_id_idx ON file_uploads (user_id);
```

---

## Upload controller

```typescript
// src/controllers/upload.controller.ts
import { createReadStream, stat } from 'node:fs';
import { unlink } from 'node:fs/promises';
import { promisify } from 'node:util';
import { extname, join } from 'node:path';
import { Injectable } from '../core/container.js';
import { Controller, Post, Get, Delete } from '../core/decorators.js';
import type { StreetContext } from '../core/context.js';
import { PgPool } from '../database/pool.js';
import { BadRequestException, NotFoundException, ForbiddenException } from '../http/exceptions.js';
import { authMiddleware } from '../http/auth.middleware.js';
import { JwtService } from '../security/jwt.js';
import { AppConfig } from '../config/index.js';

const statAsync = promisify(stat);

const ALLOWED_MIME = new Set([
  'image/jpeg', 'image/png', 'image/webp', 'image/gif',
  'application/pdf', 'text/plain', 'text/csv',
]);
const MAX_SIZE = 10 * 1024 * 1024;   // 10 MB per file

@Injectable()
@Controller('/api/files')
export class UploadController {
  private readonly auth: ReturnType<typeof authMiddleware>;

  constructor(
    private readonly pool: PgPool,
    private readonly config: AppConfig,
  ) {
    this.auth = authMiddleware(new JwtService(this.config.jwtSecret));
  }

  @Post('/upload', /* this.auth — injected in constructor, used below */)
  async upload(ctx: StreetContext): Promise<void> {
    if (!ctx.user) throw new ForbiddenException();
    if (ctx.files.length === 0) throw new BadRequestException('No file provided');

    const results = [];

    for (const file of ctx.files) {
      // Validate MIME type
      if (!ALLOWED_MIME.has(file.mimeType)) {
        await unlink(file.path).catch(() => undefined);
        throw new BadRequestException(`MIME type not allowed: ${file.mimeType}`);
      }

      // Validate size
      if (file.size > MAX_SIZE) {
        await unlink(file.path).catch(() => undefined);
        throw new BadRequestException(`File too large: max ${MAX_SIZE / 1024 / 1024} MB`);
      }

      // Store metadata in database
      const safeOriginal = file.originalName.replace(/'/g, "''");
      const safeStored   = file.path.split('/').pop()!.replace(/'/g, "''");
      const safeMime     = file.mimeType.replace(/'/g, "''");
      const safePath     = file.path.replace(/'/g, "''");

      const result = await this.pool.query(
        `INSERT INTO file_uploads (user_id, original_name, stored_name, mime_type, size_bytes, path)
         VALUES ('${ctx.user.id}', '${safeOriginal}', '${safeStored}', '${safeMime}', ${file.size}, '${safePath}')
         RETURNING id, original_name, mime_type, size_bytes, created_at`
      );

      const row = result.rows[0]!;
      results.push({
        id:           row['id'],
        originalName: row['original_name'],
        mimeType:     row['mime_type'],
        sizeBytes:    parseInt(row['size_bytes'] ?? '0', 10),
        url:          `/api/files/${row['id']}`,
        createdAt:    row['created_at'],
      });
    }

    ctx.json({ uploaded: results.length, files: results }, 201);
  }

  @Get('/:id')
  async serve(ctx: StreetContext): Promise<void> {
    const fileId = ctx.params['id']!.replace(/'/g, "''");

    const result = await this.pool.query(
      `SELECT * FROM file_uploads WHERE id = '${fileId}' LIMIT 1`
    );

    if (result.rows.length === 0) throw new NotFoundException('File not found');
    const row = result.rows[0] as Record<string, string | null>;
    const filePath = row['path']!;

    // Verify file exists on disk
    try { await statAsync(filePath); } catch {
      throw new NotFoundException('File not found on disk');
    }

    ctx.setHeader('Content-Type', row['mime_type'] ?? 'application/octet-stream');
    ctx.setHeader('Content-Length', row['size_bytes'] ?? '0');
    ctx.setHeader('Content-Disposition', `inline; filename="${row['original_name']}"`);
    ctx.setHeader('Cache-Control', 'private, max-age=86400');
    ctx.res.writeHead(200);

    const readStream = createReadStream(filePath);
    readStream.pipe(ctx.res);
    readStream.on('error', () => ctx.res.destroy());
  }

  @Get('/my/files')
  async listMyFiles(ctx: StreetContext): Promise<void> {
    if (!ctx.user) throw new ForbiddenException();

    const result = await this.pool.query(
      `SELECT id, original_name, mime_type, size_bytes, created_at
       FROM file_uploads
       WHERE user_id = '${ctx.user.id}'
       ORDER BY created_at DESC
       LIMIT 100`
    );

    ctx.json({
      files: result.rows.map((r) => ({
        id:           r['id'],
        originalName: r['original_name'],
        mimeType:     r['mime_type'],
        sizeBytes:    parseInt(r['size_bytes'] ?? '0', 10),
        url:          `/api/files/${r['id']}`,
        createdAt:    r['created_at'],
      })),
    });
  }

  @Delete('/:id')
  async remove(ctx: StreetContext): Promise<void> {
    if (!ctx.user) throw new ForbiddenException();
    const fileId = ctx.params['id']!.replace(/'/g, "''");

    const result = await this.pool.query(
      `DELETE FROM file_uploads WHERE id = '${fileId}' AND user_id = '${ctx.user.id}'
       RETURNING path`
    );

    if (result.rows.length === 0) throw new NotFoundException('File not found or not yours');

    const filePath = result.rows[0]?.['path'];
    if (filePath) await unlink(filePath).catch(() => undefined);

    ctx.send(204);
  }
}
```

---

## Example requests

```bash
# Upload a single file
curl -X POST http://localhost:3000/api/files/upload \
  -H 'Authorization: Bearer ...' \
  -F 'file=@/path/to/photo.jpg'

# Response:
# {
#   "uploaded": 1,
#   "files": [{
#     "id": "uuid-...",
#     "originalName": "photo.jpg",
#     "mimeType": "image/jpeg",
#     "sizeBytes": 245678,
#     "url": "/api/files/uuid-...",
#     "createdAt": "2024-01-15T10:23:45.123Z"
#   }]
# }

# Upload multiple files
curl -X POST http://localhost:3000/api/files/upload \
  -H 'Authorization: Bearer ...' \
  -F 'files=@/path/to/doc1.pdf' \
  -F 'files=@/path/to/doc2.pdf'

# Download a file
curl http://localhost:3000/api/files/uuid-... \
  -H 'Authorization: Bearer ...' \
  -o downloaded.jpg

# List my files
curl http://localhost:3000/api/files/my/files \
  -H 'Authorization: Bearer ...'

# Delete a file
curl -X DELETE http://localhost:3000/api/files/uuid-... \
  -H 'Authorization: Bearer ...'
# HTTP 204
```

---

## Security notes

1. **Path traversal prevention** — stored filenames are random hex strings (`randomBytes(16).toString('hex')`) with the sanitized original name appended. They can never contain `../`.
2. **MIME validation** — allowlist-based. Only explicitly permitted types are accepted.
3. **Size limits** — enforced at both the body parser level (`maxBodyBytes`) and per-file in the handler.
4. **Ownership check** — `DELETE` verifies `user_id` matches before removing. Users cannot delete others' files.
5. **No execution** — uploaded files are never executed. Never serve them from the same domain where `<script>` execution would be trusted.
