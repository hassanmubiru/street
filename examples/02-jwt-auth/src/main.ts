// examples/02-jwt-auth/src/main.ts
// JWT Authentication example with Street Framework
// Demonstrates: POST /auth/login, GET /api/me, requireRoles guard

import 'reflect-metadata';
import {
  streetApp,
  JwtService,
  authMiddleware,
  requireRoles,
  RbacService,
  rbacGuard,
  UnauthorizedException,
} from '@streetjs/core';

// ── Config ────────────────────────────────────────────────────────────────────

const JWT_SECRET = process.env['JWT_SECRET'] ?? 'example-secret-change-in-production';
const PORT = parseInt(process.env['PORT'] ?? '3001', 10);

// ── Services ──────────────────────────────────────────────────────────────────

const jwt = new JwtService({ secret: JWT_SECRET });

const rbac = new RbacService(
  { admin: ['user'], user: [] },
  { admin: ['users:manage'], user: ['profile:read'] },
);

// ── In-memory user store (demo only — use a real DB in production) ────────────

const users: Array<{ id: string; email: string; password: string; roles: string[] }> = [
  { id: 'user-1', email: 'alice@example.com', password: 'password123', roles: ['admin'] },
  { id: 'user-2', email: 'bob@example.com',   password: 'password456', roles: ['user'] },
];

// ── App ───────────────────────────────────────────────────────────────────────

const app = streetApp({ port: PORT });

// Apply auth middleware globally — populates ctx.user from Bearer token
// (skips routes where token is absent — authMiddleware is non-blocking)
app.use(authMiddleware(jwt));

// Apply RBAC guard — enforces @Roles / @Permissions on routes that declare them
app.use(rbacGuard(rbac));

// ── Routes ────────────────────────────────────────────────────────────────────

// POST /auth/login — exchange email+password for a JWT
app.use(async (ctx, next) => {
  if (ctx.method === 'POST' && ctx.path === '/auth/login') {
    const body = ctx.body as { email?: string; password?: string } | null;
    if (!body?.email || !body?.password) {
      ctx.json({ error: 'email and password are required' }, 400);
      return;
    }

    const user = users.find((u) => u.email === body.email && u.password === body.password);
    if (!user) {
      ctx.json({ error: 'Invalid credentials' }, 401);
      return;
    }

    const token = jwt.sign(
      { sub: user.id, email: user.email, roles: user.roles },
      { expiresIn: '1h' },
    );

    ctx.json({ token, expiresIn: '1h' });
    return;
  }
  await next();
});

// GET /api/me — requires a valid Bearer token
app.use(async (ctx, next) => {
  if (ctx.method === 'GET' && ctx.path === '/api/me') {
    if (!ctx.user) {
      throw new UnauthorizedException('Bearer token required');
    }
    ctx.json({
      id: ctx.user.id,
      email: ctx.user.email,
      roles: ctx.user.roles,
    });
    return;
  }
  await next();
});

// GET /api/admin — requires the 'admin' role
app.use(async (ctx, next) => {
  if (ctx.method === 'GET' && ctx.path === '/api/admin') {
    if (!ctx.user) {
      throw new UnauthorizedException('Bearer token required');
    }

    // requireRoles returns a middleware — we invoke it inline
    await new Promise<void>((resolve, reject) => {
      const guard = requireRoles('admin');
      guard(ctx, async () => resolve()).catch(reject);
    });

    ctx.json({ message: 'Welcome, admin!', user: ctx.user });
    return;
  }
  await next();
});

// ── Start ─────────────────────────────────────────────────────────────────────

app.listen(PORT, '0.0.0.0').then(() => {
  console.log(`🔐 JWT Auth API running on http://localhost:${PORT}`);
  console.log('\nTry:');
  console.log(`  curl -s -X POST http://localhost:${PORT}/auth/login \\`);
  console.log(`       -H 'Content-Type: application/json' \\`);
  console.log(`       -d '{"email":"alice@example.com","password":"password123"}'`);
  console.log(`\n  curl -s http://localhost:${PORT}/api/me \\`);
  console.log(`       -H 'Authorization: Bearer <token>'`);
});
