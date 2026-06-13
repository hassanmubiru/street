// packages/commerce/src/store.ts
// Pluggable async persistence for the commerce domain. The critical operation
// is `reserveStock`, which MUST be atomic: it succeeds only if enough stock is
// available, and increments `reserved` in the same step — this is what makes
// the no-oversell guarantee hold under concurrent checkouts.

import type { Product, Coupon, Order, Review, StockLevel } from './types.js';

export interface CommerceStore {
  // Products
  insertProduct(product: Product): Promise<void>;
  getProduct(id: string): Promise<Product | undefined>;
  listProducts(): Promise<Product[]>;
  updateProduct(product: Product): Promise<void>;

  // Inventory
  initStock(productId: string): Promise<void>;
  restock(productId: string, quantity: number): Promise<void>;
  getStock(productId: string): Promise<StockLevel>;
  /** ATOMIC: reserve `quantity` iff available >= quantity. Returns success. */
  reserveStock(productId: string, quantity: number): Promise<boolean>;
  /** Release a prior reservation (reserved -= quantity, floored at 0). */
  releaseStock(productId: string, quantity: number): Promise<void>;
  /** Commit a reservation: reserved -= quantity AND onHand -= quantity. */
  commitStock(productId: string, quantity: number): Promise<void>;

  // Coupons
  insertCoupon(coupon: Coupon): Promise<void>;
  getCoupon(code: string): Promise<Coupon | undefined>;

  // Orders
  insertOrder(order: Order): Promise<void>;
  getOrder(id: string): Promise<Order | undefined>;
  listOrders(): Promise<Order[]>;
  updateOrder(order: Order): Promise<void>;

  // Reviews
  upsertReview(review: Review): Promise<void>;
  getReview(productId: string, userId: string): Promise<Review | undefined>;
  listReviews(productId: string): Promise<Review[]>;
}

// ── In-memory store (default) ──────────────────────────────────────────────────

export class InMemoryCommerceStore implements CommerceStore {
  private readonly products = new Map<string, Product>();
  private readonly stock = new Map<string, { onHand: number; reserved: number }>();
  private readonly coupons = new Map<string, Coupon>();
  private readonly orders = new Map<string, Order>();
  private readonly reviews = new Map<string, Map<string, Review>>();

  async insertProduct(product: Product): Promise<void> {
    this.products.set(product.id, { ...product });
  }
  async getProduct(id: string): Promise<Product | undefined> {
    const p = this.products.get(id);
    return p ? { ...p } : undefined;
  }
  async listProducts(): Promise<Product[]> {
    return [...this.products.values()].map((p) => ({ ...p }));
  }
  async updateProduct(product: Product): Promise<void> {
    this.products.set(product.id, { ...product });
  }

  async initStock(productId: string): Promise<void> {
    if (!this.stock.has(productId)) this.stock.set(productId, { onHand: 0, reserved: 0 });
  }
  async restock(productId: string, quantity: number): Promise<void> {
    this.stock.get(productId)!.onHand += quantity;
  }
  async getStock(productId: string): Promise<StockLevel> {
    const s = this.stock.get(productId) ?? { onHand: 0, reserved: 0 };
    return { onHand: s.onHand, reserved: s.reserved, available: s.onHand - s.reserved };
  }
  async reserveStock(productId: string, quantity: number): Promise<boolean> {
    // Synchronous check + mutate → atomic in the single-threaded runtime.
    const s = this.stock.get(productId);
    if (!s || s.onHand - s.reserved < quantity) return false;
    s.reserved += quantity;
    return true;
  }
  async releaseStock(productId: string, quantity: number): Promise<void> {
    const s = this.stock.get(productId);
    if (s) s.reserved = Math.max(0, s.reserved - quantity);
  }
  async commitStock(productId: string, quantity: number): Promise<void> {
    const s = this.stock.get(productId);
    if (s) {
      s.reserved = Math.max(0, s.reserved - quantity);
      s.onHand = Math.max(0, s.onHand - quantity);
    }
  }

  async insertCoupon(coupon: Coupon): Promise<void> {
    this.coupons.set(coupon.code, { ...coupon });
  }
  async getCoupon(code: string): Promise<Coupon | undefined> {
    const c = this.coupons.get(code);
    return c ? { ...c } : undefined;
  }

  async insertOrder(order: Order): Promise<void> {
    this.orders.set(order.id, cloneOrder(order));
  }
  async getOrder(id: string): Promise<Order | undefined> {
    const o = this.orders.get(id);
    return o ? cloneOrder(o) : undefined;
  }
  async listOrders(): Promise<Order[]> {
    return [...this.orders.values()].map(cloneOrder);
  }
  async updateOrder(order: Order): Promise<void> {
    this.orders.set(order.id, cloneOrder(order));
  }

  async upsertReview(review: Review): Promise<void> {
    let byUser = this.reviews.get(review.productId);
    if (!byUser) {
      byUser = new Map();
      this.reviews.set(review.productId, byUser);
    }
    byUser.set(review.userId, { ...review });
  }
  async getReview(productId: string, userId: string): Promise<Review | undefined> {
    const r = this.reviews.get(productId)?.get(userId);
    return r ? { ...r } : undefined;
  }
  async listReviews(productId: string): Promise<Review[]> {
    return [...(this.reviews.get(productId)?.values() ?? [])].map((r) => ({ ...r }));
  }
}

function cloneOrder(o: Order): Order {
  return { ...o, lines: o.lines.map((l) => ({ ...l })) };
}
