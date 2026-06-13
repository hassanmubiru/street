// Throughput benchmarks for the reference apps (in-process domain ops).
// Deterministic and offline. Run: node scripts/benchmark-reference-apps.mjs
//
// Reports operations/sec for each app's core domain action. These are
// single-instance in-memory numbers (no DB/network), so they measure the
// framework's domain-logic overhead, not I/O.

import { performance } from 'node:perf_hooks';

async function bench(name, iterations, fn) {
  // warmup
  for (let i = 0; i < Math.min(100, iterations); i++) await fn(i);
  const start = performance.now();
  for (let i = 0; i < iterations; i++) await fn(i);
  const sec = (performance.now() - start) / 1000;
  const ops = Math.round(iterations / sec);
  console.log(`  ${name.padEnd(34)} ${iterations} ops in ${sec.toFixed(3)}s  →  ${ops.toLocaleString()} ops/s`);
  return ops;
}

console.log('StreetJS reference-app domain benchmarks (in-memory, single instance)\n');

// ── Ecommerce: checkouts/sec (reserve → charge → commit) ──────────────────────
{
  const { CommerceService, FakeGateway } = await import('@streetjs/commerce');
  const shop = new CommerceService({ gateway: new FakeGateway() });
  const p = await shop.createProduct({ name: 'Bench', priceCents: 100, id: 'b' });
  await shop.restock(p.id, 1_000_000);
  let n = 0;
  await bench('ecommerce: checkout', 20_000, async () => {
    const cart = `c${n++}`;
    await shop.addToCart(cart, p.id, 1);
    await shop.checkout(cart);
  });
}

// ── SaaS: authorization checks/sec ────────────────────────────────────────────
{
  const { AdminService } = await import('@streetjs/admin');
  const admin = new AdminService();
  await admin.createRole('system', { name: 'r', permissions: ['users:*', 'billing:read'] });
  const u = await admin.createUser('system', { email: 'b@e.com', roles: ['r'] });
  await bench('saas: authorization can()', 100_000, async () => { await admin.can(u.id, 'users:read'); });
}

// ── Dating: likes/sec (with reciprocal match detection) ───────────────────────
{
  const { ProfileService } = await import('@streetjs/dating-profiles');
  const { FieldCipher, Keyring } = await import('streetjs');
  const { randomBytes } = await import('node:crypto');
  const profiles = new ProfileService({ cipher: new FieldCipher(Keyring.fromKey(randomBytes(32))) });
  let n = 0;
  await bench('dating: like', 50_000, async () => {
    const a = `a${n}`, b = `b${n++}`;
    await profiles.create({ userId: a, displayName: a, bio: 'x' });
    await profiles.create({ userId: b, displayName: b, bio: 'y' });
    await profiles.like(a, b);
  });
}

// ── AI assistant: ask/sec (RAG retrieve + answer, FakeAiProvider) ─────────────
{
  const { RagPipeline, FakeAiProvider } = await import('@streetjs/ai');
  const rag = new RagPipeline({ provider: new FakeAiProvider(), topK: 3 });
  await rag.index(Array.from({ length: 200 }, (_, i) => ({ id: `d${i}`, text: `document number ${i} about topic ${i % 7}` })));
  await bench('ai-assistant: ask (RAG)', 5_000, async () => { await rag.answer('topic 3 document'); });
}

console.log('\nBenchmarks complete.');
