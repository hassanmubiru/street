// pg-commerce.integration.test.ts
// Integration tests for the Postgres CommerceStore against a live database,
// including a CONCURRENT-checkout no-oversell test that exercises the atomic
// conditional reservation. Gated on PG env vars (skips DB-free).

import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { PgPool } from 'streetjs';
import {
  CommerceService, PgCommerceStore, FakeGateway, COMMERCE_MIGRATION_SQL, InsufficientStockError,
} from '../index.js';

const HAS_PG = Boolean(process.env['PG_HOST'] && process.env['PG_DATABASE']);

describe('PgCommerceStore (live Postgres)', { skip: !HAS_PG ? 'PG_* env not set' : false }, () => {
  let pool: PgPool;
  let c: CommerceService;
  let n = 0;

  before(async () => {
    pool = new PgPool({
      host: process.env['PG_HOST']!,
      port: Number(process.env['PG_PORT'] ?? 5432),
      user: process.env['PG_USER'] ?? 'street',
      password: process.env['PG_PASSWORD'] ?? '',
      database: process.env['PG_DATABASE']!,
      maxConnections: 8,
      acquireTimeoutMs: 5_000,
    });
    await pool.query(COMMERCE_MIGRATION_SQL);
  });

  beforeEach(async () => {
    for (const t of ['orders', 'reviews', 'coupons', 'stock', 'products']) {
      await pool.query(`TRUNCATE street_commerce_${t}`);
    }
    c = new CommerceService({ store: new PgCommerceStore(pool), now: () => 1, idGen: () => `id${++n}` });
  });

  after(async () => {
    for (const t of ['orders', 'reviews', 'coupons', 'stock', 'products']) {
      await pool.query(`DROP TABLE IF EXISTS street_commerce_${t}`);
    }
    await pool.close();
  });

  it('persists products, stock, checkout, and order through the DB', async () => {
    const p = await c.createProduct({ name: 'Widget', priceCents: 1500, id: 'w1' });
    await c.restock(p.id, 5);
    await c.addToCart('cart', p.id, 2);
    await c.createCoupon({ code: 'TEN', kind: 'percent', value: 10 });

    const order = await c.checkout('cart', { couponCode: 'TEN' });
    assert.equal(order.totalCents, 2700);
    assert.equal(order.status, 'paid');
    assert.deepEqual(await c.availability(p.id), { onHand: 3, reserved: 0, available: 3 });
    assert.equal((await c.getOrder(order.id))!.totalCents, 2700);
  });

  it('rejects oversell and releases reservation on payment failure', async () => {
    const p = await c.createProduct({ name: 'Rare', priceCents: 100, id: 'r1' });
    await c.restock(p.id, 1);
    await c.addToCart('cart', p.id, 2);
    await assert.rejects(() => c.checkout('cart'), InsufficientStockError);
    assert.deepEqual(await c.availability(p.id), { onHand: 1, reserved: 0, available: 1 });

    await c.setQuantity('cart', p.id, 1);
    const failGw = new FakeGateway({ declineAtOrAbove: 1 });
    await assert.rejects(() => c.checkout('cart', { gateway: failGw }), /declined/);
    assert.deepEqual(await c.availability(p.id), { onHand: 1, reserved: 0, available: 1 });
  });

  it('NO OVERSELL under concurrent checkouts (atomic reservation)', async () => {
    const STOCK = 3;
    const ATTEMPTS = 12;
    const p = await c.createProduct({ name: 'Hot', priceCents: 500, id: 'hot' });
    await c.restock(p.id, STOCK);

    // Fire many concurrent single-unit checkouts at the same product.
    const results = await Promise.allSettled(
      Array.from({ length: ATTEMPTS }, async (_unused, i) => {
        const cart = `c${i}`;
        await c.addToCart(cart, p.id, 1);
        return c.checkout(cart);
      }),
    );

    const fulfilled = results.filter((r) => r.status === 'fulfilled').length;
    const rejected = results.filter((r) => r.status === 'rejected').length;

    assert.equal(fulfilled, STOCK, `exactly ${STOCK} checkouts should succeed, got ${fulfilled}`);
    assert.equal(rejected, ATTEMPTS - STOCK);

    const stock = await c.availability(p.id);
    assert.equal(stock.onHand, 0, 'all stock sold');
    assert.equal(stock.reserved, 0, 'no dangling reservations');
    assert.ok(stock.available >= 0, 'availability never negative');
    assert.equal((await c.listOrders()).length, STOCK);
  });

  it('cancel refunds and restocks via the DB; reviews persist', async () => {
    const gw = new FakeGateway();
    const cc = new CommerceService({ store: new PgCommerceStore(pool), gateway: gw, now: () => 1, idGen: () => `id${++n}` });
    const p = await cc.createProduct({ name: 'Widget', priceCents: 1000, id: 'wc' });
    await cc.restock(p.id, 4);
    await cc.addToCart('cart', p.id, 2);
    const order = await cc.checkout('cart');
    assert.equal((await cc.availability(p.id)).onHand, 2);
    await cc.cancelOrder(order.id);
    assert.equal((await cc.availability(p.id)).onHand, 4); // restocked
    assert.deepEqual(gw.refunded, [order.paymentId]);

    await cc.addReview({ productId: p.id, userId: 'u1', rating: 5 });
    await cc.addReview({ productId: p.id, userId: 'u1', rating: 3 }); // upsert
    assert.equal(await cc.averageRating(p.id), 3);
  });
});
