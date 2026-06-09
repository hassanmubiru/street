---
layout:    default
title:     "JWT, Sessions, Vault, XSS & Rate Limiting"
parent:    "Security"
nav_order: 1
permalink: /security/jwt/
description: "JSON Web Tokens in StreetJS — sign and verify JWTs natively, no jsonwebtoken dependency, for TypeScript backends."
---

# JWT Authentication

street's `JwtService` implements HMAC-SHA256 signed tokens using `node:crypto` exclusively. No external JWT library is involved — the implementation is auditable in under 60 lines.

---

## Setup

```typescript
import { JwtService } from '../security/jwt.js';
import { AppConfig } from '../config/index.js';

@Injectable()
export class AuthService {
  private readonly jwt: JwtService;

  constructor(private readonly config: AppConfig) {
    this.jwt = new JwtService(config.jwtSecret);  // Must be ≥ 32 chars
  }
}
```

---

## Signing tokens

```typescript
// Short-lived access token
const accessToken = jwt.sign(
  {
    sub: user.id,
    email: user.email,
    roles: user.roles,
  },
  { expiresInSeconds: 3600 }         // 1 hour
);

// Long-lived refresh token
const refreshToken = jwt.sign(
  { sub: user.id, type: 'refresh' },
  { expiresInSeconds: 86400 * 7 }    // 7 days
);

// With issuer and audience claims
const token = jwt.sign(
  { sub: user.id },
  {
    expiresInSeconds: 900,
    issuer: 'https://auth.example.com',
    audience: 'https://api.example.com',
  }
);
```

### Token structure

```
header.payload.signature

header    = base64url({"alg":"HS256","typ":"JWT"})
payload   = base64url({sub, email, roles, iat, exp, ...})
signature = HMAC-SHA256(header + "." + payload, secret)
```

---

## Verifying tokens

```typescript
const payload = jwt.verify(token);

if (!payload) {
  throw new UnauthorizedException('Invalid or expired token');
}

// payload is JwtPayload
console.log(payload.sub);    // user ID
console.log(payload.email);
console.log(payload.roles);
console.log(payload.exp);    // Unix timestamp
console.log(payload.iat);    // Issued at
```

`verify()` returns `null` (never throws) when:
- The token is malformed (wrong number of segments)
- The signature does not match (tampered payload or wrong secret)
- The token has expired (`exp < now`)
- The token was issued in the future (`iat > now + 60s` clock skew allowance)
- Issuer or audience mismatch (when options are provided)

### Timing-safe comparison

The signature comparison uses `crypto.timingSafeEqual()`. This prevents timing side-channel attacks where an attacker could learn the secret byte-by-byte by measuring comparison time.

---

## Auth middleware

```typescript
import { authMiddleware, requireRoles } from '../http/auth.middleware.js';

// Protect a single route
@Get('/profile', authMiddleware(jwt))
async profile(ctx: StreetContext): Promise<void> {
  ctx.json({ user: ctx.user });
}

// Role-based access
@Delete('/admin/user/:id', authMiddleware(jwt), requireRoles('admin'))
async deleteUser(ctx: StreetContext): Promise<void> {
  // Only admins reach here
}
```

After `authMiddleware` succeeds, `ctx.user` is populated:

```typescript
ctx.user = {
  id: 'uuid-from-sub-claim',
  email: 'user@example.com',
  roles: ['user', 'editor'],
};
```

---

## Login flow example

```typescript
@Post('/login')
@Validate(loginSchema)
async login(ctx: StreetContext): Promise<void> {
  const { email, password } = ctx.body as LoginDto;
  const tokens = await this.authService.login(email, password);
  ctx.json(tokens);
}
```

```bash
curl -X POST http://localhost:3000/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"alice@example.com","password":"secret123"}'

# Response:
{
  "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "expiresIn": 3600
}
```

---

# Encrypted Sessions

Sessions store user state server-side, encrypted with AES-256-GCM. The client holds only an opaque session ID cookie. The plaintext session data never touches disk.

---

## Setup

```typescript
import { SessionManager } from '../security/session.js';

// SESSION_KEY must be a 64-character hex string (32 bytes)
const sessionManager = new SessionManager(config.sessionKey);
```

---

## Creating a session

```typescript
@Post('/login')
async login(ctx: StreetContext): Promise<void> {
  const user = await this.userService.login(ctx.body as LoginDto);

  // Encrypt session data
  const sessionData = {
    userId: user.id,
    email: user.email,
    roles: user.roles,
    csrf: SessionManager.generateCsrf(),
  };
  const encrypted = sessionManager.encrypt(sessionData);

  // Store as HttpOnly cookie
  ctx.setCookie('session', encrypted, {
    httpOnly: true,
    secure: ctx.headers['x-forwarded-proto'] === 'https',
    sameSite: 'Lax',
    maxAge: 86400,
    path: '/',
  });

  ctx.json({ success: true, csrfToken: sessionData.csrf });
}
```

---

## Reading a session

```typescript
@Get('/profile')
async profile(ctx: StreetContext): Promise<void> {
  const blob = ctx.cookie('session');
  if (!blob) throw new UnauthorizedException('No session cookie');

  const session = sessionManager.decrypt(blob);
  if (!session) throw new UnauthorizedException('Invalid session');

  const user = await this.userService.findById(session.userId as string);
  ctx.json(user);
}
```

`decrypt()` returns `null` if the blob is tampered, truncated, or encrypted with a different key. The AES-256-GCM authentication tag detects any modification.

---

## Encryption internals

Each `encrypt()` call:
1. Generates a random 12-byte IV (using `crypto.randomBytes`)
2. Creates an AES-256-GCM cipher with the 32-byte session key and IV
3. Encrypts the JSON payload
4. Appends the 16-byte authentication tag

The stored blob is: `[12 bytes IV][16 bytes auth tag][N bytes ciphertext]` encoded as base64.

The IV is random per-encryption, so two encryptions of the same data produce different blobs. This prevents cookie replay analysis.

---

# Vault Mode

Vault Mode lets you store encrypted secrets in environment variables. Only the KEK (Key Encryption Key) needs to be provided at runtime.

---

## Why Vault Mode?

Without it, production secrets (DB passwords, API keys) must be passed as plaintext environment variables. They appear in:
- CI/CD logs
- Process lists (`ps aux`)
- Container inspection (`docker inspect`)
- Deployment manifests checked into source control

With Vault Mode:
- Secrets are encrypted at rest in env vars or config files
- The KEK is the only secret that must be protected
- Decryption happens once at startup, in memory, never on disk

---

## Encrypting a secret

```typescript
import { encryptSecret } from '../security/vault.js';

const encrypted = encryptSecret('my-database-password-here', 'my-kek-passphrase');
console.log(encrypted);
// base64-encoded blob: WxrJ3mF...
```

Run as a one-off script:

```bash
KEK=my-kek node -e "
import('./dist/src/security/vault.js').then(m => {
  console.log(m.encryptSecret(process.argv[2], process.env.KEK));
});" -- 'plaintext-secret'
```

---

## Storing and using encrypted secrets

```bash
# .env
PG_PASSWORD=base64EncryptedBlob...  # commit this
KEK=                                # NEVER commit the KEK
```

Mark the field as encrypted in `AppConfig`:

```typescript
@Config('PG_PASSWORD', { encrypted: true, required: true })
pgPassword: string = '';
```

At startup, `config.load(kek)` decrypts it:

```typescript
const config = new AppConfig();
config.load(process.env['KEK']);  // Decrypts PG_PASSWORD in memory
```

---

## Key derivation

Vault Mode uses scrypt to derive the encryption key from the KEK:

```
scrypt(KEK, random_salt, N=16384, r=8, p=1) → 32-byte key
AES-256-GCM(key, random_iv, plaintext) → ciphertext + auth_tag
```

scrypt is memory-hard (64 MB by default) — brute-forcing the KEK requires significant memory per attempt.

---

# XSS Protection

The XSS sanitizer recursively processes all string values in `ctx.body`, removing HTML and dangerous attributes before your handlers ever see them.

---

## What it removes

- HTML tags: `<script>`, `<img>`, `<div>`, etc.
- `javascript:` protocol in strings
- `data:` and `vbscript:` protocols
- Event handler attributes: `onerror=`, `onclick=`, `onload=`
- Null bytes (`\x00`)

---

## Global middleware (recommended)

```typescript
import { xssMiddleware } from './security/xss.js';
app.use(xssMiddleware);
```

---

## Manual sanitization

```typescript
import { sanitizeString, sanitizeDeep } from '../security/xss.js';

// Single string
const safe = sanitizeString('<script>alert(1)</script>hello');
// → 'hello'

// Nested object
const safeBody = sanitizeDeep({
  name: '<b>Alice</b>',
  bio: '<script>xss</script>',
  address: { city: 'Springfield' },
}) as { name: string; bio: string };
// → { name: 'Alice', bio: '', address: { city: 'Springfield' } }
```

---

## Depth and size limits

- Maximum recursion depth: 32 levels
- Maximum string length processed: 1 MB
- Maximum array length: 10,000 items
- Maximum object keys: 500

These bounds prevent crafted payloads from causing unbounded stack depth or excessive CPU time.

---

# Rate Limiting

The rate limiter uses a sliding-window algorithm with BigInt nanosecond precision. Each IP's request timestamps are stored in a bounded circular buffer.

---

## Setup

```typescript
import { RateLimiter } from './security/ratelimit.js';

const limiter = new RateLimiter({
  windowMs: 60_000,       // 1-minute sliding window
  maxRequests: 100,       // Per IP per window
  message: 'Too Many Requests',
});

app.use(limiter.middleware());
```

---

## Per-route limiting

```typescript
const strictLimiter = new RateLimiter({
  windowMs: 60_000,
  maxRequests: 5,          // Only 5 login attempts per minute
});

@Post('/login', strictLimiter.middleware())
async login(ctx: StreetContext): Promise<void> { /* ... */ }
```

---

## Custom key function

By default, the key is the client IP (from `X-Forwarded-For` or `socket.remoteAddress`). Override for user-based limiting:

```typescript
const userLimiter = new RateLimiter({
  windowMs: 60_000,
  maxRequests: 200,
  keyFn: (ctx) => ctx.user?.id ?? ctx.req.socket.remoteAddress ?? 'anon',
});
```

---

## Response headers

The middleware automatically sets:

```
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 87
```

When the limit is exceeded, it throws `RateLimitException` (HTTP 429):

```json
{
  "error": "RateLimitException",
  "message": "Too Many Requests",
  "status": 429
}
```

---

## Memory safety

Each IP can store at most `MAX_REQUESTS_PER_KEY` (1,000) timestamps. The total number of tracked IPs is capped at `MAX_KEYS` (100,000). When the cap is reached, the oldest IP is evicted.

A sweep interval (half the window length) removes expired entries from all tracked IPs, preventing stale keys from accumulating indefinitely.

```typescript
// Cleanup when the server shuts down
limiter.destroy();  // Clears the sweep interval and all stored data
```
