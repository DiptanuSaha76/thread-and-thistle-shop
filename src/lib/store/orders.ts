import { lineKey, products, type CartLine, type Order } from "./catalogue";
import {
  normalizeShipmentStage,
  shipmentStageClass,
  shipmentStageLabel,
  type ShipmentStage,
} from "@/lib/shipping/status";

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
    shippingStatus: normalizeShipmentStage(null, status),
    shippingStatusSource: null,
    shippingStatusAt: o.delivered_at ?? o.shipped_at ?? null,
    shippingLastEventLabel: null,
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
  label: string;
  done: boolean;
  /** A real recorded time, or null. Never calculated. */
  at: string | null;
  /** Shown when there is no date: "—", "Done", or "Current". */
  note: string;
};

export function customerOrderStatus(order: Pick<Order, "status" | "shippingStatus">): string {
  if (order.status === "Awaiting payment") return "Awaiting payment";
  const stage = order.shippingStatus ?? normalizeShipmentStage(null, order.status);
  return shipmentStageLabel(stage);
}

export function customerOrderStatusClass(order: Pick<Order, "status" | "shippingStatus">): string {
  return `status-${shipmentStageClass(customerOrderStatus(order))}`;
}

/** Customers may cancel only before pickup has been requested / parcel dispatched. */
export function canCustomerCancelOrder(order: Pick<Order, "status" | "shippingStatus" | "tracking">): boolean {
  if (order.tracking) return false;
  const status = customerOrderStatus(order);
  return status === "Awaiting payment" || status === "Processing";
}

/**
 * Customer progress mirrors the exact admin shipping stage. Dates are shown only
 * when YEARTH has a timestamp for that current stage; older completed steps say Done.
 */
export function orderTimeline(
  order: Pick<Order, "status" | "shippingStatus" | "createdAt" | "shippedAt" | "deliveredAt" | "shippingStatusAt">,
): TimelineStep[] {
  const stage: ShipmentStage = order.shippingStatus ?? normalizeShipmentStage(null, order.status);
  if (stage === "cancelled") {
    return [
      { label: "Order Placed", done: true, at: order.createdAt, note: "" },
      { label: "Cancelled", done: true, at: order.shippingStatusAt ?? null, note: order.shippingStatusAt ? "" : "Status updated" },
    ];
  }

  const flow: Array<{ stage: ShipmentStage; label: string }> = [
    { stage: "processing", label: "Processing" },
    { stage: "ready_to_ship", label: "Ready to ship" },
    { stage: "pickup_scheduled", label: "Pickup scheduled" },
    { stage: "picked_up", label: "Picked up" },
    { stage: "in_transit", label: "In transit" },
    { stage: "out_for_delivery", label: "Out for delivery" },
    { stage: "delivered", label: "Delivered" },
  ];
  const progressStage: ShipmentStage =
    stage === "ndr_action_required" ? "out_for_delivery"
      : stage === "rto_initiated" ? "in_transit"
      : stage;
  const currentIndex = Math.max(0, flow.findIndex((item) => item.stage === progressStage));

  const steps: TimelineStep[] = [
    { label: "Order Placed", done: true, at: order.createdAt, note: "" },
    ...flow.map((item, index) => {
      const done = index <= currentIndex;
      const isSpecialStage = stage === "ndr_action_required" || stage === "rto_initiated";
      const isCurrent = item.stage === progressStage && !isSpecialStage;
      const fallbackTime = item.stage === "in_transit" ? order.shippedAt ?? null
        : item.stage === "delivered" ? order.deliveredAt ?? null
        : null;
      const at = isCurrent ? (order.shippingStatusAt ?? fallbackTime) : fallbackTime;
      return {
        label: item.label,
        done,
        at: done ? at : null,
        note: !done ? "—" : at ? "" : isCurrent ? "Current" : "Done",
      };
    }),
  ];

  if (stage === "ndr_action_required" || stage === "rto_initiated") {
    steps.push({
      label: shipmentStageLabel(stage),
      done: true,
      at: order.shippingStatusAt ?? null,
      note: order.shippingStatusAt ? "" : "Current",
    });
  }
  return steps;
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
