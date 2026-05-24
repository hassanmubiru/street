---
layout:    default
title:     "Multipart Uploads"
parent:    "Storage"
nav_order: 1
permalink: /storage/multipart-uploads/
---

# Multipart File Uploads

street's multipart parser streams file uploads directly to disk. At no point is the full file content held in memory. A 4 GB video upload has the same heap footprint as a 4 KB thumbnail.

---

## How it works

The parser is a streaming state machine that processes the raw `multipart/form-data` wire format chunk by chunk:

```
POST /upload
Content-Type: multipart/form-data; boundary=----WebKitFormBoundary7MA4YWxk

------WebKitFormBoundary7MA4YWxk
Content-Disposition: form-data; name="file"; filename="photo.jpg"
Content-Type: image/jpeg

<binary data written chunk-by-chunk to disk>
------WebKitFormBoundary7MA4YWxk
Content-Disposition: form-data; name="description"

My vacation photo
------WebKitFormBoundary7MA4YWxk--
```

The parser:
1. Detects part boundaries as data flows in
2. Reads part headers (Content-Disposition, Content-Type)
3. For file parts: opens a write stream to disk and flushes chunks immediately
4. For text parts: buffers up to `MAX_FIELD_SIZE` (64 KB) in memory
5. On any error: deletes partial files already written

---

## Parsed result

After parsing completes, `ctx.files` and `ctx.body` are populated:

```typescript
// ctx.files: ParsedFile[]
interface ParsedFile {
  fieldName: string;      // Name of the <input> field
  originalName: string;   // Original filename from the browser
  mimeType: string;       // Content-Type from the part header
  size: number;           // Bytes written to disk
  path: string;           // Absolute path in the uploads directory
  encoding: string;       // Transfer encoding (usually '7bit')
}

// ctx.body: Record<string, string>  (non-file fields)
```

---

## Basic upload handler

```typescript
import { Injectable } from '../core/container.js';
import { Controller, Post } from '../core/decorators.js';
import type { StreetContext } from '../core/context.js';
import { BadRequestException } from '../http/exceptions.js';

@Injectable()
@Controller('/api/files')
export class FileController {

  @Post('/upload')
  async upload(ctx: StreetContext): Promise<void> {
    if (ctx.files.length === 0) {
      throw new BadRequestException('No file provided');
    }

    const file = ctx.files[0]!;

    ctx.json({
      message: 'Upload successful',
      file: {
        name:     file.originalName,
        mimeType: file.mimeType,
        size:     file.size,
        path:     file.path,         // e.g. /app/uploads/a3f8c2d1e9b0_photo.jpg
      },
    }, 201);
  }
}
```

---

## Multiple files

```typescript
@Post('/gallery')
async uploadGallery(ctx: StreetContext): Promise<void> {
  if (ctx.files.length === 0) {
    throw new BadRequestException('At least one file required');
  }

  // Process each uploaded file
  const results = ctx.files.map((file) => ({
    id:       generateUuid(),
    name:     file.originalName,
    mimeType: file.mimeType,
    size:     file.size,
    url:      `/files/${encodeURIComponent(file.originalName)}`,
  }));

  // Persist to database
  for (const result of results) {
    await this.fileRepo.create(result);
  }

  ctx.json({ uploaded: results.length, files: results }, 201);
}
```

---

## Mixed files and form fields

`ctx.body` contains non-file fields; `ctx.files` contains file parts:

```html
<form enctype="multipart/form-data">
  <input name="title" type="text" />
  <input name="file" type="file" />
</form>
```

```typescript
@Post('/document')
async uploadDocument(ctx: StreetContext): Promise<void> {
  const fields = ctx.body as Record<string, string>;
  const title = fields['title'] ?? 'Untitled';

  if (ctx.files.length === 0) {
    throw new BadRequestException('No document file provided');
  }

  const file = ctx.files[0]!;
  await this.docService.create({ title, filePath: file.path, mimeType: file.mimeType });

  ctx.json({ title, uploaded: file.originalName }, 201);
}
```

---

## File type validation

The parser does not validate MIME types — it trusts the Content-Type from the part header, which the client can spoof. Always validate by inspecting the actual file contents or extension:

```typescript
import { extname } from 'node:path';

const ALLOWED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
const ALLOWED_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif']);

@Post('/avatar')
async uploadAvatar(ctx: StreetContext): Promise<void> {
  if (ctx.files.length === 0) {
    throw new BadRequestException('No file provided');
  }

  const file = ctx.files[0]!;
  const ext = extname(file.originalName).toLowerCase();

  // Validate MIME type (client-provided, but useful for UX)
  if (!ALLOWED_IMAGE_TYPES.has(file.mimeType)) {
    throw new BadRequestException(`File type not allowed: ${file.mimeType}`);
  }

  // Validate extension
  if (!ALLOWED_EXTENSIONS.has(ext)) {
    throw new BadRequestException(`File extension not allowed: ${ext}`);
  }

  // Validate size (parser respects maxBodyBytes, but you can add tighter limits)
  const MAX_AVATAR_SIZE = 5 * 1024 * 1024;   // 5 MB
  if (file.size > MAX_AVATAR_SIZE) {
    throw new BadRequestException('Avatar file must be smaller than 5 MB');
  }

  await this.userService.setAvatar(ctx.user!.id, file.path);
  ctx.json({ uploaded: true }, 201);
}
```

---

## File size limits

The global `maxBodyBytes` option on `streetApp()` limits total upload size:

```typescript
const app = streetApp({
  maxBodyBytes: 50 * 1024 * 1024,   // 50 MB max upload
  uploadsDir: './uploads',
});
```

If the upload exceeds this limit, the socket is destroyed and a 413 error is returned before the full file is parsed — preventing oversized uploads from consuming disk space.

---

## Serving uploaded files

street does not include a static file server. In production, serve uploads via nginx, a CDN, or cloud storage. For development:

```typescript
// Simple dev-only static file handler
import { createReadStream, stat } from 'node:fs';
import { promisify } from 'node:util';
import { join, extname } from 'node:path';

const statAsync = promisify(stat);

@Get('/files/:filename')
async serveFile(ctx: StreetContext): Promise<void> {
  const filename = ctx.params['filename']!;

  // Prevent path traversal
  if (filename.includes('..') || filename.includes('/')) {
    throw new BadRequestException('Invalid filename');
  }

  const filePath = join('./uploads', filename);

  try {
    const info = await statAsync(filePath);
    const mimeType = guessMime(extname(filename));

    ctx.setHeader('Content-Type', mimeType);
    ctx.setHeader('Content-Length', String(info.size));
    ctx.setHeader('Cache-Control', 'public, max-age=86400');
    ctx.res.writeHead(200);

    const stream = createReadStream(filePath);
    stream.pipe(ctx.res);
    stream.on('error', () => ctx.res.destroy());
  } catch {
    throw new NotFoundException('File not found');
  }
}

function guessMime(ext: string): string {
  const map: Record<string, string> = {
    '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
    '.png': 'image/png',  '.webp': 'image/webp',
    '.gif': 'image/gif',  '.pdf': 'application/pdf',
    '.txt': 'text/plain', '.json': 'application/json',
  };
  return map[ext.toLowerCase()] ?? 'application/octet-stream';
}
```

---

## Error handling and cleanup

If parsing fails (e.g., client disconnects mid-upload), the parser deletes any partially written files:

```typescript
// Inside MultipartParser.parse():
} catch (err) {
  for (const filePath of createdFiles) {
    unlink(filePath, () => undefined);   // Non-blocking cleanup
  }
  throw err;
}
```

This prevents orphaned partial files from accumulating in the uploads directory.

---

## Memory profile

The parser uses a maximum of ~128 KB of memory per request regardless of file size:
- One active chunk buffer: 64 KB (`MAX_FILE_CHUNK`)
- One field buffer: 64 KB (`MAX_FIELD_SIZE`)

The chunk is written to disk and freed before the next chunk is read. GC pressure is minimal.

---

## Production uploads directory

In production, mount the uploads directory as a persistent volume:

```yaml
# docker-compose.yml
services:
  app:
    volumes:
      - uploads_data:/app/uploads

volumes:
  uploads_data:
```

Or use object storage by replacing the `path` handling in your service layer:

```typescript
// Instead of serving from disk, upload the file to S3/R2/GCS
const s3Url = await this.storageService.upload(file.path, file.mimeType);

// Then delete the local temp file
await unlink(file.path);

ctx.json({ url: s3Url }, 201);
```
