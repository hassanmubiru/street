// benchmarks/compare/servers.mjs
// Equivalent benchmark servers for Street, Express, Fastify, NestJS, and Hono.
// Every server exposes GET / → {"status":"ok"} and returns { name, port, close }.
// Resolved competitor modules come from this directory's local node_modules so
// the framework's own package stays dependency-light.

import 'reflect-metadata';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const coreIndex = join(here, '..', '..', 'packages', 'core', 'dist', 'index.js');

async function listen(server, port) {
  await new Promise((resolve) => server.listen(port, '127.0.0.1', resolve));
}

export async function startStreet(port) {
  const { streetApp } = await import(coreIndex);
  const app = streetApp({ port });
  app.use(async (ctx) => { if (ctx.path === '/') ctx.json({ status: 'ok' }); });
  await app.listen(port);
  return { name: 'Street', port, close: () => app.close() };
}

export async function startExpress(port) {
  const { default: express } = await import('express');
  const app = express();
  app.get('/', (_req, res) => res.json({ status: 'ok' }));
  const server = app.listen(port, '127.0.0.1');
  await new Promise((r) => server.on('listening', r));
  return { name: 'Express', port, close: () => new Promise((r) => server.close(r)) };
}

export async function startFastify(port) {
  const { default: Fastify } = await import('fastify');
  const app = Fastify({ logger: false });
  app.get('/', () => ({ status: 'ok' }));
  await app.listen({ port, host: '127.0.0.1' });
  return { name: 'Fastify', port, close: () => app.close() };
}

export async function startHono(port) {
  const { Hono } = await import('hono');
  const { serve } = await import('@hono/node-server');
  const app = new Hono();
  app.get('/', (c) => c.json({ status: 'ok' }));
  const server = serve({ fetch: app.fetch, port, hostname: '127.0.0.1' });
  return { name: 'Hono', port, close: () => new Promise((r) => server.close(r)) };
}

export async function startNest(port) {
  const { NestFactory } = await import('@nestjs/core');
  const { Module, Controller, Get } = await import('@nestjs/common');

  class AppController {
    getRoot() { return { status: 'ok' }; }
  }
  // Apply decorators programmatically (no TS compile step in this harness).
  Get('/')(AppController.prototype, 'getRoot', Object.getOwnPropertyDescriptor(AppController.prototype, 'getRoot'));
  Controller()(AppController);

  class AppModule {}
  Module({ controllers: [AppController] })(AppModule);

  const app = await NestFactory.create(AppModule, { logger: false });
  await app.listen(port, '127.0.0.1');
  return { name: 'NestJS', port, close: () => app.close() };
}

export const FACTORIES = {
  Street: startStreet,
  Express: startExpress,
  Fastify: startFastify,
  NestJS: startNest,
  Hono: startHono,
};
