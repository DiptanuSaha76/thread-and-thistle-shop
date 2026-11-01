/**
 * Customer order tracking. SERVER ONLY.
 *
 * 1. The order is read with the CUSTOMER's own session (row-level security), and
 *    its user_id must match the signed-in user, before anything is returned.
 * 2. The AWB is the order's tracking number, which only an admin can set.
 * 3. Shiprocket is asked at most once per order every 30 minutes (5 minutes
 *    after a failure); results are cached in public.order_shipments.
 * 4. Shiprocket's status text is shown as-is. Order status is never changed
 *    here, and returned/lost/damaged shipments are not interpreted.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/integrations/supabase/types";
import {
  isTrackableAwb,
  ShiprocketError,
  type TrackingEvent,
  type TrackingSnapshot,
} from "./shiprocket.server";

type Db = SupabaseClient<Database>;
type ShipmentRow = Database["public"]["Tables"]["order_shipments"]["Row"];

export class TrackingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TrackingError";
  }
}

export type OrderTracking =
  | { state: "not_shipped" }
  /** A tracking number exists but live tracking is not switched on (or the number is not an AWB). */
  | { state: "manual"; awb: string }
  /** Shiprocket has no scan activity for this AWB yet. */
  | { state: "pending"; awb: string; trackUrl: string | null; updatedAt: string | null }
  | {
      state: "tracking";
      awb: string;
      currentStatus: string | null;
      estimatedDelivery: string | null;
      trackUrl: string | null;
      events: TrackingEvent[];
      updatedAt: string | null;
      /** True when Shiprocket could not be reached and older saved data is shown. */
      stale: boolean;
    }
  | { state: "unavailable"; awb: string };

export const FRESH_MS = 30 * 60 * 1000;
export const RETRY_AFTER_FAILURE_MS = 5 * 60 * 1000;

type Deps = {
  /** The signed-in customer's client (row-level security applies). */
  userDb: Db;
  /** Service-role client, used only after the ownership check. */
  adminDb: Db;
  tracker: { trackAwb: (awb: string) => Promise<TrackingSnapshot> } | null;
  now?: () => number;
};

const SHIPPED = new Set(["Shipped", "Delivered"]);

function eventsFrom(value: Json): TrackingEvent[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((e): e is { [key: string]: Json } => !!e && typeof e === "object" && !Array.isArray(e))
    .map((e) => ({
      time: String(e["time"] ?? ""),
      activity: String(e["activity"] ?? ""),
      location: String(e["location"] ?? ""),
    }))
    .filter((e) => e.activity)
    .slice(0, 50);
}

function fromRow(row: ShipmentRow, stale: boolean): OrderTracking {
  if (!row.last_synced_at) return { state: "unavailable", awb: row.awb };
  if (row.last_result !== "ok")
    return {
      state: "pending",
      awb: row.awb,
      trackUrl: row.track_url,
      updatedAt: row.last_synced_at,
    };
  return {
    state: "tracking",
    awb: row.awb,
    currentStatus: row.current_status,
    estimatedDelivery: row.estimated_delivery,
    trackUrl: row.track_url,
    events: eventsFrom(row.events),
    updatedAt: row.last_synced_at,
    stale,
  };
}

export async function getOrderTracking(
  deps: Deps,
  userId: string,
  orderId: string,
): Promise<OrderTracking> {
  const now = deps.now ?? Date.now;
  const { data: order, error } = await deps.userDb
    .from("orders")
    .select("id, user_id, status, tracking_number")
    .eq("id", orderId)
    .maybeSingle();
  if (error) {
    console.error("[tracking] Could not load the order:", error.message);
    throw new TrackingError("We couldn't load tracking right now. Please try again.");
  }
  if (!order || order.user_id !== userId) throw new TrackingError("We couldn't find that order.");

  const awb = order.tracking_number?.trim() ?? "";
  if (!awb || !SHIPPED.has(order.status)) return { state: "not_shipped" };
  if (!deps.tracker || !isTrackableAwb(awb)) return { state: "manual", awb };

  const cached = await deps.adminDb
    .from("order_shipments")
    .select("*")
    .eq("order_id", order.id)
    .maybeSingle();
  if (cached.error)
    console.error("[tracking] Could not read saved tracking:", cached.error.message);
  const row = cached.data && cached.data.awb === awb ? cached.data : null;
  const synced = row?.last_synced_at ? Date.parse(row.last_synced_at) : 0;
  const attempted = row?.last_attempt_at ? Date.parse(row.last_attempt_at) : 0;
  if (row && synced && now() - synced < FRESH_MS) return fromRow(row, false);
  if (row && attempted > synced && now() - attempted < RETRY_AFTER_FAILURE_MS)
    return fromRow(row, true);

  const stamp = new Date(now()).toISOString();
  try {
    const snapshot = await deps.tracker.trackAwb(awb);
    const saved: ShipmentRow = {
      order_id: order.id,
      provider: "shiprocket",
      awb,
      current_status: snapshot.currentStatus,
      estimated_delivery: snapshot.estimatedDelivery,
      track_url: snapshot.trackUrl,
      events: snapshot.events as unknown as Json,
      last_result: snapshot.result,
      last_attempt_at: stamp,
      last_synced_at: stamp,
      created_at: row?.created_at ?? stamp,
      updated_at: stamp,
    };
    const write = await deps.adminDb
      .from("order_shipments")
      .upsert(saved, { onConflict: "order_id" });
    if (write.error) console.error("[tracking] Could not save tracking:", write.error.message);
    return fromRow(saved, false);
  } catch (failure) {
    const kind = failure instanceof ShiprocketError ? failure.kind : "unexpected";
    console.error(`[tracking] Shiprocket tracking failed (${kind}).`);
    const attempt: Database["public"]["Tables"]["order_shipments"]["Insert"] = row
      ? { ...row, last_attempt_at: stamp, updated_at: stamp }
      : {
          order_id: order.id,
          provider: "shiprocket",
          awb,
          events: [] as Json,
          last_result: "error",
          last_attempt_at: stamp,
          updated_at: stamp,
        };
    const write = await deps.adminDb
      .from("order_shipments")
      .upsert(attempt, { onConflict: "order_id" });
    if (write.error)
      console.error("[tracking] Could not record the failed attempt:", write.error.message);
    return row ? fromRow(row, true) : { state: "unavailable", awb };
  }
}
