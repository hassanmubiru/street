// packages/commerce/src/types.ts
// Shared commerce domain types, errors, and the payment-gateway contract.
// Money is always integer minor units (e.g. cents).

export type Cents = number;

export class InsufficientStockError extends Error {
  constructor(public readonly productId: string, public readonly requested: number, public readonly available: number) {
    super(`Insufficient stock for "${productId}": requested ${requested}, available ${available}`);
    this.name = 'InsufficientStockError';
  }
}

export class PaymentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PaymentError';
  }
}

export interface Product {
  id: string;
  name: string;
  priceCents: Cents;
  currency: string;
  active: boolean;
}

export interface StockLevel {
  onHand: number;
  reserved: number;
  available: number;
}

export interface CartLine {
  product: Product;
  quantity: number;
  lineTotalCents: Cents;
}

export interface Cart {
  id: string;
  lines: CartLine[];
  subtotalCents: Cents;
  currency: string | null;
}

export type CouponKind = 'percent' | 'fixed';

export interface Coupon {
  code: string;
  kind: CouponKind;
  value: number;
  active: boolean;
  minSubtotalCents: Cents;
}

export interface DiscountResult {
  discountCents: Cents;
  totalCents: Cents;
}

export type OrderStatus = 'paid' | 'cancelled';

export interface OrderLine {
  productId: string;
  quantity: number;
  unitPriceCents: Cents;
}

export interface Order {
  id: string;
  lines: OrderLine[];
  currency: string;
  subtotalCents: Cents;
  discountCents: Cents;
  totalCents: Cents;
  couponCode: string | null;
  paymentId: string;
  status: OrderStatus;
  createdAt: number;
}

export interface Review {
  id: string;
  productId: string;
  userId: string;
  rating: number;
  text: string;
  createdAt: number;
}

// ── Payment gateway ─────────────────────────────────────────────────────────────

export interface ChargeRequest {
  amountCents: Cents;
  currency: string;
  reference: string;
}

export interface ChargeResult {
  id: string;
  status: 'succeeded';
}

export interface PaymentGateway {
  readonly name: string;
  charge(request: ChargeRequest): Promise<ChargeResult>;
  refund(paymentId: string): Promise<void>;
}
