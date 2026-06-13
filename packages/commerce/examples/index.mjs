// Runnable example: a tiny storefront checkout flow.
//
//   npm run example -w packages/commerce
//
// Uses the in-memory store + deterministic FakeGateway (no DB, no network).
// Swap in `new PgCommerceStore(pool)` (with COMMERCE_MIGRATION_SQL applied) to
// persist to Postgres — same API.

import { CommerceService, FakeGateway } from '@streetjs/commerce';

const gateway = new FakeGateway();
const shop = new CommerceService({ gateway });

const tshirt = await shop.createProduct({ name: 'T-Shirt', priceCents: 2000 });
const mug = await shop.createProduct({ name: 'Mug', priceCents: 1200 });
await shop.restock(tshirt.id, 5);
await shop.restock(mug.id, 3);
await shop.createCoupon({ code: 'WELCOME', kind: 'fixed', value: 500 });

await shop.addToCart('cart-1', tshirt.id, 2);
await shop.addToCart('cart-1', mug.id, 1);
const cart = await shop.getCart('cart-1');
console.log('cart subtotal:', cart.subtotalCents, 'cents');

const order = await shop.checkout('cart-1', { couponCode: 'WELCOME' });
console.log('order:', { subtotal: order.subtotalCents, discount: order.discountCents, total: order.totalCents, status: order.status });
console.log('t-shirt availability after sale:', await shop.availability(tshirt.id));

await shop.addToCart('cart-2', mug.id, 10);
try {
  await shop.checkout('cart-2');
} catch (err) {
  console.log('\noversell prevented ->', err.name + ':', err.message);
}

await shop.addReview({ productId: tshirt.id, userId: 'u1', rating: 5, text: 'Great fit' });
await shop.addReview({ productId: tshirt.id, userId: 'u2', rating: 4 });
console.log('\nt-shirt average rating:', await shop.averageRating(tshirt.id));

const cancelled = await shop.cancelOrder(order.id);
console.log('cancelled order status:', cancelled.status, '| refunds:', gateway.refunded.length, '| t-shirt on hand:', (await shop.availability(tshirt.id)).onHand);
