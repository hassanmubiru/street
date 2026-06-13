// packages/commerce/src/pg.ts
// Postgres-backed CommerceStore. The no-oversell guarantee rests on
// `reserveStock` being a single atomic conditional UPDATE:
//
//   UPDATE ... SET reserved = reserved + n WHERE on_hand - reserved >= n
//
// Row-level locking on that UPDATE serializes concurrent reservations, so two
// simultaneous checkouts can never both succeed past the available stock.

import type { Product, Coupon, Order, Review, StockLevel } from './types.js';
import type { CommerceStore } from './store.js';

export const COMMERCE_MIGRATION_SQL = `
CREATE TABLE IF NOT EXISTS street_commerce_products (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  price_cents BIGINT NOT NULL,
  currency    TEXT NOT NULL,
  active      BOOLEAN NOT NULL DEFAULT TRUE
);
CREATE TABLE IF NOT EXISTS street_commerce_stock (
  product_id TEXT PRIMARY KEY,
  on_hand    INTEGER NOT NULL DEFAULT 0,
  reserved   INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT street_commerce_stock_nonneg CHECK (on_hand >= 0 AND reserved >= 0 AND reserved <= on_hand)
);
CREATE TABLE IF NOT EXISTS street_commerce_coupons (
  code              TEXT PRIMARY KEY,
  kind              TEXT NOT NULL,
  value             INTEGER NOT NULL,
  active            BOOLEAN NOT NULL DEFAULT TRUE,
  min_subtotal_cents BIGINT NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS street_commerce_orders (
  id             TEXT PRIMARY KEY,
  lines          JSONB NOT NULL,
  currency       TEXT NOT NULL,
  subtotal_cents BIGINT NOT NULL,
  discount_cents BIGINT NOT NULL,
  total_cents    BIGINT NOT NULL,
  coupon_code    TEXT,
  payment_id     TEXT NOT NULL,
  status         TEXT NOT NULL,
  created_at     BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS street_commerce_reviews (
  product_id TEXT NOT NULL,
  user_id    TEXT NOT NULL,
  id         TEXT NOT NULL,
  rating     INTEGER NOT NULL,
  text       TEXT NOT NULL,
  created_at BIGINT NOT NULL,
  PRIMARY KEY (product_id, user_id)
);
`.trim();

export interface CommercePool {
  query(
    sql: string,
    params?: unknown[],
  ): Promise<{ rows: Record<string, unknown>[]; rowCount: number; command: string }>;
}

export class PgCommerceStore implements CommerceStore {
  constructor(private readonly pool: CommercePool) {}

  async insertProduct(p: Product): Promise<void> {
    await this.pool.query(
      `INSERT INTO street_commerce_products (id, name, price_cents, currency, active)
       VALUES ($1, $2, $3, $4, $5)`,
      [p.id, p.name, p.priceCents, p.currency, p.active],
    );
  }
  async getProduct(id: string): Promise<Product | undefined> {
    const res = await this.pool.query(`SELECT * FROM street_commerce_products WHERE id = $1`, [id]);
    return res.rows[0] ? rowToProduct(res.rows[0]) : undefined;
  }
  async listProducts(): Promise<Product[]> {
    const res = await this.pool.query(`SELECT * FROM street_commerce_products`, []);
    return res.rows.map(rowToProduct);
  }
  async updateProduct(p: Product): Promise<void> {
    await this.pool.query(
      `UPDATE street_commerce_products SET name = $2, price_cents = $3, currency = $4, active = $5 WHERE id = $1`,
      [p.id, p.name, p.priceCents, p.currency, p.active],
    );
  }

  async initStock(productId: string): Promise<void> {
    await this.pool.query(
      `INSERT INTO street_commerce_stock (product_id, on_hand, reserved) VALUES ($1, 0, 0)
       ON CONFLICT (product_id) DO NOTHING`,
      [productId],
    );
  }
  async restock(productId: string, quantity: number): Promise<void> {
    await this.pool.query(
      `UPDATE street_commerce_stock SET on_hand = on_hand + $2 WHERE product_id = $1`,
      [productId, quantity],
    );
  }
  async getStock(productId: string): Promise<StockLevel> {
    const res = await this.pool.query(
      `SELECT on_hand, reserved FROM street_commerce_stock WHERE product_id = $1`,
      [productId],
    );
    const row = res.rows[0];
    const onHand = Number(row?.['on_hand'] ?? 0);
    const reserved = Number(row?.['reserved'] ?? 0);
    return { onHand, reserved, available: onHand - reserved };
  }
  async reserveStock(productId: string, quantity: number): Promise<boolean> {
    // Atomic: the WHERE clause guards availability; the row is locked for the
    // duration of the UPDATE, serializing concurrent reservations.
    const res = await this.pool.query(
      `UPDATE street_commerce_stock SET reserved = reserved + $2
       WHERE product_id = $1 AND on_hand - reserved >= $2`,
      [productId, quantity],
    );
    return res.rowCount > 0;
  }
  async releaseStock(productId: string, quantity: number): Promise<void> {
    await this.pool.query(
      `UPDATE street_commerce_stock SET reserved = GREATEST(0, reserved - $2) WHERE product_id = $1`,
      [productId, quantity],
    );
  }
  async commitStock(productId: string, quantity: number): Promise<void> {
    await this.pool.query(
      `UPDATE street_commerce_stock
       SET reserved = GREATEST(0, reserved - $2), on_hand = GREATEST(0, on_hand - $2)
       WHERE product_id = $1`,
      [productId, quantity],
    );
  }

  async insertCoupon(c: Coupon): Promise<void> {
    await this.pool.query(
      `INSERT INTO street_commerce_coupons (code, kind, value, active, min_subtotal_cents)
       VALUES ($1, $2, $3, $4, $5)`,
      [c.code, c.kind, c.value, c.active, c.minSubtotalCents],
    );
  }
  async getCoupon(code: string): Promise<Coupon | undefined> {
    const res = await this.pool.query(`SELECT * FROM street_commerce_coupons WHERE code = $1`, [code]);
    const r = res.rows[0];
    if (!r) return undefined;
    return {
      code: String(r['code']),
      kind: String(r['kind']) === 'fixed' ? 'fixed' : 'percent',
      value: Number(r['value']),
      active: r['active'] === true || r['active'] === 't',
      minSubtotalCents: Number(r['min_subtotal_cents']),
    };
  }

  async insertOrder(o: Order): Promise<void> {
    await this.pool.query(
      `INSERT INTO street_commerce_orders
         (id, lines, currency, subtotal_cents, discount_cents, total_cents, coupon_code, payment_id, status, created_at)
       VALUES ($1, $2::jsonb, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [o.id, JSON.stringify(o.lines), o.currency, o.subtotalCents, o.discountCents, o.totalCents, o.couponCode, o.paymentId, o.status, o.createdAt],
    );
  }
  async getOrder(id: string): Promise<Order | undefined> {
    const res = await this.pool.query(`SELECT * FROM street_commerce_orders WHERE id = $1`, [id]);
    return res.rows[0] ? rowToOrder(res.rows[0]) : undefined;
  }
  async listOrders(): Promise<Order[]> {
    const res = await this.pool.query(`SELECT * FROM street_commerce_orders`, []);
    return res.rows.map(rowToOrder);
  }
  async updateOrder(o: Order): Promise<void> {
    await this.pool.query(`UPDATE street_commerce_orders SET status = $2 WHERE id = $1`, [o.id, o.status]);
  }

  async upsertReview(r: Review): Promise<void> {
    await this.pool.query(
      `INSERT INTO street_commerce_reviews (product_id, user_id, id, rating, text, created_at)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (product_id, user_id) DO UPDATE SET rating = EXCLUDED.rating, text = EXCLUDED.text`,
      [r.productId, r.userId, r.id, r.rating, r.text, r.createdAt],
    );
  }
  async getReview(productId: string, userId: string): Promise<Review | undefined> {
    const res = await this.pool.query(
      `SELECT * FROM street_commerce_reviews WHERE product_id = $1 AND user_id = $2`,
      [productId, userId],
    );
    return res.rows[0] ? rowToReview(res.rows[0]) : undefined;
  }
  async listReviews(productId: string): Promise<Review[]> {
    const res = await this.pool.query(`SELECT * FROM street_commerce_reviews WHERE product_id = $1`, [productId]);
    return res.rows.map(rowToReview);
  }
}

function rowToProduct(r: Record<string, unknown>): Product {
  return {
    id: String(r['id']),
    name: String(r['name']),
    priceCents: Number(r['price_cents']),
    currency: String(r['currency']),
    active: r['active'] === true || r['active'] === 't',
  };
}

function rowToOrder(r: Record<string, unknown>): Order {
  const rawLines = r['lines'];
  const lines = typeof rawLines === 'string' ? JSON.parse(rawLines) : (rawLines as Order['lines']);
  return {
    id: String(r['id']),
    lines: lines as Order['lines'],
    currency: String(r['currency']),
    subtotalCents: Number(r['subtotal_cents']),
    discountCents: Number(r['discount_cents']),
    totalCents: Number(r['total_cents']),
    couponCode: r['coupon_code'] == null ? null : String(r['coupon_code']),
    paymentId: String(r['payment_id']),
    status: String(r['status']) === 'cancelled' ? 'cancelled' : 'paid',
    createdAt: Number(r['created_at']),
  };
}

function rowToReview(r: Record<string, unknown>): Review {
  return {
    id: String(r['id']),
    productId: String(r['product_id']),
    userId: String(r['user_id']),
    rating: Number(r['rating']),
    text: String(r['text']),
    createdAt: Number(r['created_at']),
  };
}
