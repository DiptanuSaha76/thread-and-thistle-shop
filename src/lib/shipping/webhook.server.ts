/** Shiprocket tracking webhook processor. SERVER ONLY. */
import { createHash } from "node:crypto";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { Database, Json } from "@/integrations/supabase/types";

type Row = Record<string, unknown>;

function asRecord(value: unknown): Row | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Row : null;
}

function text(value: unknown, max = 180): string {
  if (typeof value !== "string" && typeof value !== "number") return "";
  return String(value).replace(/[\u0000-\u001f<>]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
}

function number(value: unknown): number | null {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isInteger(n) && n > 0 ? n : null;
}

function records(value: unknown, output: Row[] = [], depth = 0): Row[] {
  if (depth > 8 || !value || typeof value !== "object") return output;
  if (Array.isArray(value)) {
    for (const item of value) records(item, output, depth + 1);
    return output;
  }
  const row = value as Row;
  output.push(row);
  for (const child of Object.values(row)) records(child, output, depth + 1);
  return output;
}

function dateFrom(value: unknown): string | null {
  const raw = text(value, 80);
  if (!raw) return null;
  let parsed = Date.parse(raw);
  // Shiprocket also sends timestamps like "23 05 2023 11:43:52".
  if (!Number.isFinite(parsed)) {
    const match = raw.match(/^(\d{2})\s+(\d{2})\s+(\d{4})\s+(\d{2}):(\d{2}):(\d{2})$/);
    if (match) parsed = Date.parse(`${match[3]}-${match[2]}-${match[1]}T${match[4]}:${match[5]}:${match[6]}+05:30`);
  }
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function getJsonEvents(value: Json): Array<{ time: string; activity: string; location: string }> {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const row = asRecord(item);
    if (!row) return [];
    return [{ time: text(row["time"], 80), activity: text(row["activity"], 180), location: text(row["location"], 120) }]
      .filter((event) => !!event.activity);
  });
}

export async function applyShiprocketWebhook(payload: unknown, source: "webhook" | "tracking_api" = "webhook"): Promise<{ received: number; matched: number; duplicates: number }> {
  const rawCandidates = records(payload).filter((row) => !!(row["awb"] ?? row["awb_code"]));
  // Shiprocket may wrap the same event inside data/response objects. Collapse
  // duplicate copies before touching Supabase so one webhook creates one event.
  const unique = new Map<string, Row>();
  for (const row of rawCandidates) {
    const signature = [
      text(row["awb"] ?? row["awb_code"], 50),
      text(row["current_timestamp"] ?? row["event_time"] ?? row["timestamp"] ?? row["updated_at"], 80),
      text(row["current_status_id"] ?? "", 20),
      text(row["shipment_status_id"] ?? "", 20),
      text(row["current_status"] ?? row["shipment_status"] ?? "", 120),
      text(row["location"] ?? row["current_location"] ?? row["scanned_location"] ?? "", 120),
    ].join("|");
    if (!unique.has(signature)) unique.set(signature, row);
  }
  const candidates = [...unique.values()];
  let matched = 0;
  let duplicates = rawCandidates.length - candidates.length;

  for (const row of candidates) {
    const awb = text(row["awb"] ?? row["awb_code"], 50);
    if (!awb) continue;
    const currentStatus = text(row["current_status"] ?? row["shipment_status"], 120) || null;
    const shipmentStatus = text(row["shipment_status"] ?? row["current_status"], 120) || null;
    const currentStatusId = number(row["current_status_id"]);
    const shipmentStatusId = number(row["shipment_status_id"]);
    const statusId = shipmentStatusId ?? currentStatusId;
    const allStatusIds = [shipmentStatusId, currentStatusId].filter((value): value is number => value !== null);
    const statusText = `${shipmentStatus ?? ""} ${currentStatus ?? ""}`.toLowerCase();
    const eventAt = dateFrom(row["current_timestamp"] ?? row["event_time"] ?? row["timestamp"] ?? row["updated_at"]);
    const location = text(row["location"] ?? row["current_location"] ?? row["scanned_location"], 120) || null;
    const receivedAt = new Date().toISOString();

    const { data: fulfilment, error: fulfilmentError } = await supabaseAdmin
      .from("shiprocket_fulfillments")
      .select("order_id,awb,last_tracking_event_at")
      .eq("awb", awb)
      .maybeSingle();
    if (fulfilmentError) throw new Error("Could not match the tracking webhook to a YEARTH fulfilment.");
    if (!fulfilment) continue;

    const eventKey = createHash("sha256")
      .update([awb, eventAt ?? "no-time", String(statusId ?? ""), statusText, location ?? ""].join("|"))
      .digest("hex");
    const { error: eventError } = await supabaseAdmin.from("shiprocket_webhook_events").upsert({
      event_key: eventKey,
      order_id: fulfilment.order_id,
      awb,
      current_status: currentStatus,
      current_status_id: currentStatusId,
      shipment_status: shipmentStatus,
      shipment_status_id: shipmentStatusId,
      event_at: eventAt,
      location,
      received_at: receivedAt,
    }, { onConflict: "event_key", ignoreDuplicates: true });
    if (eventError) throw new Error("Could not save the tracking webhook event.");

    const { data: cached, error: cacheReadError } = await supabaseAdmin
      .from("order_shipments")
      .select("*")
      .eq("order_id", fulfilment.order_id)
      .maybeSingle();
    if (cacheReadError) throw new Error("Could not load the existing customer tracking cache.");
    const previousEventTime = fulfilment.last_tracking_event_at ? Date.parse(fulfilment.last_tracking_event_at) : 0;
    const incomingEventTime = eventAt ? Date.parse(eventAt) : 0;
    const isOlderEvent = !!(previousEventTime && incomingEventTime && incomingEventTime < previousEventTime);

    const event = { time: eventAt ?? receivedAt, activity: shipmentStatus ?? currentStatus ?? "Shipment update", location: location ?? "" };
    const prior = getJsonEvents(cached?.events ?? []);
    const isDuplicateEvent = prior.some((old) => old.time === event.time && old.activity === event.activity && old.location === event.location);
    const mergedEvents = (isDuplicateEvent ? prior : [event, ...prior])
      .sort((a, b) => (Date.parse(b.time) || 0) - (Date.parse(a.time) || 0))
      .slice(0, 50);
    const { error: cacheWriteError } = await supabaseAdmin.from("order_shipments").upsert({
      order_id: fulfilment.order_id,
      provider: "shiprocket",
      awb,
      current_status: isOlderEvent ? (cached?.current_status ?? null) : (shipmentStatus ?? currentStatus),
      estimated_delivery: cached?.estimated_delivery ?? null,
      track_url: cached?.track_url ?? null,
      events: mergedEvents as unknown as Json,
      last_result: "ok",
      last_attempt_at: receivedAt,
      last_synced_at: receivedAt,
      created_at: cached?.created_at ?? receivedAt,
      updated_at: receivedAt,
    }, { onConflict: "order_id" });
    if (cacheWriteError) throw new Error("Could not update the customer tracking cache.");

    const hasCode = (codes: number[]) => allStatusIds.some((code) => codes.includes(code));
    const isDelivered = hasCode([7]) || /\bdelivered\b/.test(statusText);
    const isRto = hasCode([9, 10, 14, 40, 41, 46]) || /rto|return to origin/.test(statusText);
    const isNdr = hasCode([21, 40]) || /ndr|undelivered|delivery attempted|delivery failed/.test(statusText);
    const isOutForDelivery = /out for delivery|out-for-delivery/.test(statusText);
    const isPickedUp = /picked up|pickup done|picked-up|shipment picked/.test(statusText);
    const isPickupScheduled = /pickup scheduled|pickup generated|pickup requested|ready for pickup/.test(statusText);
    const isMoving = hasCode([3, 4, 5, 6, 17, 18, 27, 38, 42, 48, 50, 51, 52]) || /in transit|shipped|reached at destination|reached destination/.test(statusText);
    const normalizedStage = isDelivered ? "delivered"
      : isRto ? "rto_initiated"
      : isNdr ? "ndr_action_required"
      : isOutForDelivery ? "out_for_delivery"
      : isPickedUp ? "picked_up"
      : isPickupScheduled ? "pickup_scheduled"
      : isMoving ? "in_transit"
      : "tracking_updated";
    const isPhysicallyMoving = ["picked_up", "in_transit", "out_for_delivery", "delivered", "ndr_action_required", "rto_initiated"].includes(normalizedStage);

    if (!isOlderEvent) {
      const fulfilmentUpdate: Database["public"]["Tables"]["shiprocket_fulfillments"]["Update"] = {
        last_tracking_status: shipmentStatus ?? currentStatus,
        last_tracking_status_id: statusId,
        last_tracking_event_at: eventAt,
        fulfilment_status: normalizedStage,
        status_source: source,
        updated_at: receivedAt,
      };
      const { error: fulfilmentUpdateError } = await supabaseAdmin.from("shiprocket_fulfillments")
        .update(fulfilmentUpdate).eq("order_id", fulfilment.order_id);
      if (fulfilmentUpdateError) throw new Error("Could not update YEARTH fulfilment status.");
    }

    const { data: order, error: orderReadError } = await supabaseAdmin.from("orders")
      .select("id,status,shipped_at,delivered_at")
      .eq("id", fulfilment.order_id)
      .maybeSingle();
    if (orderReadError) throw new Error("Could not load the YEARTH order for tracking status sync.");
    if (!isOlderEvent && order && order.status !== "Cancelled" && order.status !== "Delivered") {
      if (isDelivered) {
        // The store's order guard allows Processing → Shipped → Delivered.
        if (order.status === "Processing") {
          const { error: shippedError } = await supabaseAdmin.from("orders").update({ status: "Shipped", shipped_at: receivedAt, updated_at: receivedAt }).eq("id", order.id);
          if (shippedError) console.error("[shipping-webhook] Delivered event arrived but YEARTH could not move the order to Shipped first.");
        }
        const { error } = await supabaseAdmin.from("orders").update({ status: "Delivered", delivered_at: receivedAt, updated_at: receivedAt }).eq("id", order.id);
        if (error) console.error("[shipping-webhook] Shipment was delivered but YEARTH order status could not be updated.");
      } else if (isPhysicallyMoving && order.status === "Processing") {
        const { error } = await supabaseAdmin.from("orders").update({ status: "Shipped", shipped_at: receivedAt, updated_at: receivedAt }).eq("id", order.id);
        if (error) console.error("[shipping-webhook] Shipment is moving but YEARTH order status could not be updated.");
      }
    }
    matched += 1;
    if (isDuplicateEvent) duplicates += 1;
  }

  return { received: candidates.length, matched, duplicates };
}
