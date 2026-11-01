import { lineKey, products, type CartLine, type Order } from "./catalogue";

/**
 * Pure helpers for orders and the saved bag, shared by the store (state.tsx)
 * and tests. No React or network code here.
 */

/** An order request the database refused; `code` is the database reason (e.g. OUT_OF_STOCK). */
export class CheckoutError extends Error {
  constructor(
    message: string,
    readonly code: string | null,
  ) {
    super(message);
    this.name = "CheckoutError";
  }
}

/** Order columns customers are allowed to read (see the orders migration). */
export const ORDER_COLUMNS =
  "id, order_number, created_at, status, subtotal, shipping, discount, total, payment_method, payment_status, " +
  "tracking_number, shipped_at, delivered_at, ship_name, ship_phone, ship_address, ship_city, ship_state, ship_pincode, " +
  "order_items(product_id, colour, size, quantity)";

/**
 * Order amounts and quantities are stored as text on the live database ("1438"), so the
 * API returns strings. Convert them here so the app always adds up numbers.
 */
export const amountFromDb = (value: number | string | null | undefined): number => {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
};

export type OrderRow = {
  id: string;
  order_number: string;
  created_at: string;
  status: string;
  subtotal: number | string;
  shipping: number | string;
  discount: number | string;
  total: number | string;
  payment_method: string;
  payment_status: string;
  tracking_number: string | null;
  shipped_at?: string | null;
  delivered_at?: string | null;
  ship_name: string;
  ship_phone: string;
  ship_address: string;
  ship_city: string;
  ship_state: string;
  ship_pincode: string;
  order_items: {
    product_id: string | null;
    colour: string;
    size: string;
    quantity: number | string;
  }[];
};

const knownStatuses: Order["status"][] = ["Processing", "Shipped", "Delivered", "Cancelled"];

export const toOrder = (o: OrderRow): Order => {
  const online = o.payment_method !== "cod";
  const paid = o.payment_status === "paid";
  const status = knownStatuses.find((s) => s === o.status) ?? "Processing";
  return {
    id: o.order_number,
    dbId: o.id,
    createdAt: o.created_at,
    status: status === "Processing" && online && !paid ? "Awaiting payment" : status,
    items: o.order_items.map((i) => ({
      productId: i.product_id ?? "",
      colour: i.colour,
      size: i.size,
      quantity: amountFromDb(i.quantity),
    })),
    subtotal: amountFromDb(o.subtotal),
    shipping: amountFromDb(o.shipping),
    discount: amountFromDb(o.discount),
    total: amountFromDb(o.total),
    tracking: o.tracking_number,
    shippedAt: o.shipped_at ?? null,
    deliveredAt: o.delivered_at ?? null,
    paymentMethod: !online
      ? "Cash on Delivery"
      : paid
        ? "Paid online"
        : "Online payment (not confirmed yet)",
    shippingAddress: {
      fullName: o.ship_name,
      phone: o.ship_phone,
      address: o.ship_address,
      city: o.ship_city,
      state: o.ship_state,
      pincode: o.ship_pincode,
    },
  };
};

export type TimelineStep = {
  label: "Order Placed" | "Processed" | "Shipped" | "Delivered";
  done: boolean;
  /** A real recorded time, or null. Never calculated. */
  at: string | null;
  /** Shown when there is no date: "—" (not reached), "Done" or "Date not recorded". */
  note: string;
};

/**
 * The My Orders timeline, from recorded data only: the order time, and the shipped /
 * delivered times the database records when the status changes. Nothing is estimated.
 * "Processed" has no separate event in the database, so it shows no date.
 */
export function orderTimeline(order: Pick<Order, "status" | "createdAt" | "shippedAt" | "deliveredAt">): TimelineStep[] {
  const delivered = order.status === "Delivered";
  const shipped = delivered || order.status === "Shipped";
  const missing = (done: boolean) => (done ? "Date not recorded" : "—");
  return [
    { label: "Order Placed", done: true, at: order.createdAt, note: "" },
    { label: "Processed", done: shipped, at: null, note: shipped ? "Done" : "—" },
    { label: "Shipped", done: shipped, at: shipped ? (order.shippedAt ?? null) : null, note: missing(shipped) },
    { label: "Delivered", done: delivered, at: delivered ? (order.deliveredAt ?? null) : null, note: missing(delivered) },
  ];
}

/** Keeps only well-formed cart lines for products that exist, max 10 each. */
export function sanitizeCart(value: unknown): CartLine[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter(
      (l): l is CartLine =>
        !!l &&
        typeof l === "object" &&
        typeof (l as CartLine).productId === "string" &&
        typeof (l as CartLine).size === "string" &&
        typeof (l as CartLine).colour === "string" &&
        Number.isInteger((l as CartLine).quantity) &&
        (l as CartLine).quantity > 0 &&
        products.some((p) => p.id === (l as CartLine).productId),
    )
    .map((l) => ({
      productId: l.productId,
      colour: l.colour,
      size: l.size,
      quantity: Math.min(l.quantity, 10),
    }));
}

/** Combines the saved (account) bag with the bag built while signed out. */
export function mergeCarts(saved: CartLine[], local: CartLine[]): CartLine[] {
  const merged = new Map<string, CartLine>();
  for (const line of [...saved, ...local]) {
    const existing = merged.get(lineKey(line));
    merged.set(
      lineKey(line),
      existing
        ? { ...existing, quantity: Math.min(10, Math.max(existing.quantity, line.quantity)) }
        : line,
    );
  }
  return [...merged.values()].slice(0, 50);
}

export const sanitizeWishlist = (value: unknown) =>
  Array.isArray(value)
    ? value
        .filter((id): id is string => typeof id === "string" && products.some((p) => p.id === id))
        .slice(0, 200)
    : [];
