// src/main.ts
// Street application entry point.

import 'reflect-metadata';
import { resolve } from 'node:path';
import {
  streetApp,
  container,
  securityHeaders,
  corsMiddleware,
  xssMiddleware,
  telemetryMiddleware,
  TelemetryTracker,
  RateLimiter,
  StreetWebSocketServer,
  PgPool,
  StreetMigrationRunner,
  JwtService,
  SessionManager,
  WebhookDispatcher,
  LruCache,
} from '@streetjs/core';
import { HealthController } from './controllers/health.controller.js';
import { ExampleController } from './controllers/example.controller.js';

async function bootstrap(): Promise<void> {
  // ── Configuration ────────────────────────────────────────────────────
  const port = parseInt(process.env['PORT'] ?? '3000', 10);
  const host = process.env['HOST'] ?? '0.0.0.0';
  const uploadsDir = resolve(process.env['UPLOADS_DIR'] ?? './uploads');
  // Note: MIGRATIONS_DIR env var is used by the migration runner internally

  // ── Database pool ────────────────────────────────────────────────────
  const pool = new PgPool({
    host: process.env['PG_HOST'] ?? 'localhost',
    port: parseInt(process.env['PG_PORT'] ?? '5432', 10),
    user: process.env['PG_USER'] ?? 'postgres',
    password: process.env['PG_PASSWORD'] ?? '',
    database: process.env['PG_DATABASE'] ?? 'street',
    minConnections: 2,
    maxConnections: 10,
    idleTimeoutMs: 30_000,
    acquireTimeoutMs: 5_000,
  });
  await pool.initialize();
  container.register(PgPool, pool);

  // ── Services ─────────────────────────────────────────────────────────
  const telemetry = new TelemetryTracker(60_000);
  container.register(TelemetryTracker, telemetry);

  const wsServer = new StreetWebSocketServer({
    heartbeatIntervalMs: 30_000,
    maxConnections: 10_000,
  });
  container.register(StreetWebSocketServer, wsServer);

  container.register(
    StreetMigrationRunner,
    new StreetMigrationRunner(pool)
  );
  container.register(JwtService, new JwtService(process.env['JWT_SECRET'] ?? 'dev-secret'));
  container.register(SessionManager, new SessionManager(process.env['SESSION_KEY'] ?? 'dev-session-key'));
  container.register(WebhookDispatcher, new WebhookDispatcher());
  container.register(LruCache, new LruCache({ maxEntries: 1000, ttlMs: 60_000 }));

  // ── HTTP server ──────────────────────────────────────────────────────
  const rateLimiter = new RateLimiter({ windowMs: 60_000, maxRequests: 300 });

  const app = streetApp({
    port,
    host,
    uploadsDir,
    requestTimeoutMs: 30_000,
    maxBodyBytes: 1_048_576,
  });

  // Global middleware
  app.use(securityHeaders);
  app.use(corsMiddleware(['*']));
  app.use(xssMiddleware);
  app.use(telemetryMiddleware(telemetry));
  app.use(rateLimiter.middleware());

  // Register controllers
  app.registerController(HealthController);
  app.registerController(ExampleController);

  // ── OpenAPI spec ──────────────────────────────────────────────────────
  const openApiSpec = app.openApiSpec();
  app.use(async (ctx, next) => {
    if (ctx.path === '/openapi.json' && ctx.method === 'GET') {
      ctx.json(openApiSpec);
      return;
    }
    await next();
  });

  // ── Start server ─────────────────────────────────────────────────────
  await app.listen(port, host);

  // ── Graceful shutdown ────────────────────────────────────────────────
  const shutdown = async (signal: string): Promise<void> => {
    console.log(`[street] Received ${signal}. Shutting down...`);
    try {
      await app.close();
      await wsServer.close();
      await pool.close();
      telemetry.destroy();
      rateLimiter.destroy();
    } catch (err) {
      console.error('[street] Shutdown error:', err);
    }
    process.exit(0);
  };

  process.once('SIGTERM', () => shutdown('SIGTERM'));
  process.once('SIGINT', () => shutdown('SIGINT'));
}

bootstrap().catch((err) => {
  console.error('[street] Fatal error:', err);
  process.exit(1);
});
