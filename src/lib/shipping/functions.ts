import { createMiddleware, createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { checkTrackingNumber } from "./awb";
import type { Json } from "@/integrations/supabase/types";

const requireAdmin = createMiddleware({ type: "function" })
  .middleware([requireSupabaseAuth])
  .server(async ({ context, next }) => {
    const { data, error } = await context.supabase.rpc("is_admin");
    if (error || data !== true) throw new Error("Admin access required");
    return next();
  });

const orderIdSchema = z.string().trim().min(1).max(100);
/**
 * Public, read-only pincode serviceability lookup. Product package data is loaded
 * from Supabase on the server; neither Shiprocket credentials nor arbitrary parcel
 * dimensions are accepted from the browser.
 */
export const checkShippingServiceability = createServerFn({ method: "POST" })
  .validator(
    z.object({
      deliveryPincode: z.string().regex(/^[1-9]\d{5}$/),
      cod: z.boolean().default(true),
      items: z.array(z.object({ productId: z.string().min(1).max(100), quantity: z.number().int().min(1).max(100) })).min(1).max(50),
      declaredValue: z.number().nonnegative().optional(),
    }),
  )
  .handler(async ({ data }) => {
    try {
      const [{ supabaseAdmin }, { createShiprocketFulfilmentClient, estimateParcelFromProducts }] = await Promise.all([
        import("@/integrations/supabase/client.server"),
        import("./fulfillment.server"),
      ]);
      const productIds = [...new Set(data.items.map((item) => item.productId))];
      const { data: productRows, error } = await supabaseAdmin
        .from("products")
        .select("id,shipping_weight_kg,shipping_length_cm,shipping_breadth_cm,shipping_height_cm,active")
        .in("id", productIds);
      if (error) throw new Error("Product shipping specifications could not be loaded. Please try again.");
      const availableProducts = (productRows ?? []).filter((product) => product.active);
      const parcel = estimateParcelFromProducts(availableProducts, data.items);
      const result = await createShiprocketFulfilmentClient().checkByPincode({
        deliveryPincode: data.deliveryPincode,
        cod: data.cod,
        declaredValue: data.declaredValue,
        parcel,
      });
      return { ...result, parcelEstimate: parcel };
    } catch (error) {
      console.error("[shipping] Serviceability check failed:", error instanceof Error ? error.message : "unknown error");
      throw new Error(error instanceof Error ? error.message : "Delivery availability could not be checked.");
    }
  });

/** Admin NDR inbox: reads Shiprocket's live NDR list, then maps AWBs to YEARTH orders. */
export const getShiprocketNdrCases = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
  .handler(async () => {
    const [{ supabaseAdmin }, { createShiprocketFulfilmentClient }] = await Promise.all([
      import("@/integrations/supabase/client.server"),
      import("./fulfillment.server"),
    ]);
    const cases = await createShiprocketFulfilmentClient().getNdrCases(1, 100);
    const awbs = cases.map((item) => item.awb).filter(Boolean);
    if (!awbs.length) return [];
    const { data: fulfilments, error: fulfilmentError } = await supabaseAdmin
      .from("shiprocket_fulfillments")
      .select("order_id,awb")
      .in("awb", awbs);
    if (fulfilmentError) throw new Error("YEARTH order references for NDR cases could not be loaded.");
    const orderIds = [...new Set((fulfilments ?? []).map((row) => row.order_id))];
    const { data: orders, error: orderError } = orderIds.length
      ? await supabaseAdmin.from("orders").select("id,order_number").in("id", orderIds)
      : { data: [], error: null };
    if (orderError) throw new Error("YEARTH order references for NDR cases could not be loaded.");
    const byAwb = new Map((fulfilments ?? []).map((row) => [row.awb ?? "", row.order_id]));
    const byOrderId = new Map((orders ?? []).map((row) => [row.id, row.order_number]));
    return cases.map((item) => ({ ...item, yearthOrderNumber: byOrderId.get(byAwb.get(item.awb) ?? "") ?? null }));
  });

/** Admin submits an NDR re-attempt or RTO action to Shiprocket. */
export const actOnShiprocketNdr = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
  .validator(z.object({
    awb: z.string().trim().min(5).max(50).regex(/^[A-Za-z0-9-]+$/),
    action: z.enum(["re-attempt", "return"]),
    comments: z.string().trim().min(2).max(250),
    phone: z.string().trim().optional(),
  }))
  .handler(async ({ data }) => {
    const [{ supabaseAdmin }, { createShiprocketFulfilmentClient }] = await Promise.all([
      import("@/integrations/supabase/client.server"),
      import("./fulfillment.server"),
    ]);
    const result = await createShiprocketFulfilmentClient().actOnNdr(data);
    const { error } = await supabaseAdmin.from("shiprocket_fulfillments")
      .update({ last_ndr_action: data.action, last_ndr_action_at: new Date().toISOString(), fulfilment_status: data.action === "re-attempt" ? "ndr_reattempt_requested" : "rto_requested", updated_at: new Date().toISOString() })
      .eq("awb", data.awb);
    if (error && error.code !== "PGRST116") console.error("[shipping] NDR action was sent but local fulfilment metadata could not be updated:", error.message);
    return result;
  });

/** Admin read-only refresh of a manually linked AWB. It never creates or books a shipment. */
export const refreshManualShiprocketTracking = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
  .validator(z.object({ orderId: orderIdSchema }))
  .handler(async ({ data }) => {
    const [{ supabaseAdmin }, { shiprocketClient }, { applyShiprocketWebhook }] = await Promise.all([
      import("@/integrations/supabase/client.server"),
      import("./shiprocket.server"),
      import("./webhook.server"),
    ]);
    const { data: fulfilment, error } = await supabaseAdmin.from("shiprocket_fulfillments")
      .select("awb")
      .eq("order_id", data.orderId)
      .maybeSingle();
    if (error || !fulfilment?.awb) throw new Error("Link the Shiprocket AWB to this YEARTH order first.");
    const tracker = shiprocketClient();
    if (!tracker) throw new Error("Tracking API is disabled or API credentials are missing. Configure SHIPROCKET_TRACKING_ENABLED and the server-only API user credentials.");

    const snapshot = await tracker.trackAwb(fulfilment.awb);
    const timestamp = new Date().toISOString();
    const { error: cacheError } = await supabaseAdmin.from("order_shipments").upsert({
      order_id: data.orderId,
      provider: "shiprocket",
      awb: fulfilment.awb,
      current_status: snapshot.currentStatus,
      estimated_delivery: snapshot.estimatedDelivery,
      track_url: snapshot.trackUrl,
      events: snapshot.events as unknown as Json,
      last_result: snapshot.result,
      last_attempt_at: timestamp,
      last_synced_at: timestamp,
      updated_at: timestamp,
    }, { onConflict: "order_id" });
    if (cacheError) throw new Error("Shiprocket returned tracking details, but YEARTH could not save the tracking cache.");

    if (snapshot.currentStatus) {
      const latest = snapshot.events[0];
      await applyShiprocketWebhook({
        awb: fulfilment.awb,
        current_status: snapshot.currentStatus,
        shipment_status: snapshot.currentStatus,
        event_time: latest?.time || timestamp,
        location: latest?.location || "",
      }, "tracking_api");
    }

    return { ok: true, awb: fulfilment.awb, result: snapshot.result, currentStatus: snapshot.currentStatus, estimatedDelivery: snapshot.estimatedDelivery, updatedAt: timestamp };
  });

/**
 * Returns only the signed-in customer's own compact shipment-status records.
 * The private fulfilment table is queried with the server service role only after
 * the user's own order IDs have been resolved through their authenticated session.
 */
export const getCustomerShipmentStatuses = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data: ownedOrders, error: ordersError } = await context.supabase
      .from("orders")
      .select("id")
      .eq("user_id", context.userId);
    if (ordersError) throw new Error("Your shipment statuses could not be loaded.");

    const orderIds = (ownedOrders ?? []).map((row) => row.id);
    if (!orderIds.length) return [];

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin
      .from("shiprocket_fulfillments")
      .select("order_id,fulfilment_status,status_source,awb,last_tracking_status,last_tracking_event_at,updated_at")
      .in("order_id", orderIds);
    if (error) {
      console.error("[shipping] Customer shipment status lookup failed:", error.message);
      throw new Error("Your shipment statuses could not be loaded.");
    }

    return (data ?? []).map((row) => ({
      order_id: row.order_id,
      fulfilment_status: row.fulfilment_status,
      status_source: row.status_source,
      awb: row.awb,
      last_tracking_status: row.last_tracking_status,
      last_tracking_event_at: row.last_tracking_event_at,
      updated_at: row.updated_at,
    }));
  });

/** Existing customer tracking function: only the signed-in user's own order can be tracked. */
export const getOrderTracking = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(z.object({ orderId: orderIdSchema }))
  .handler(async ({ data, context }) => {
    const { getOrderTracking: track, TrackingError } = await import("./tracking.server");
    const { shiprocketClient } = await import("./shiprocket.server");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    try {
      return await track({ userDb: context.supabase, adminDb: supabaseAdmin, tracker: shiprocketClient() }, context.userId, data.orderId);
    } catch (error) {
      if (error instanceof TrackingError) throw new Error(error.message);
      console.error("[tracking] Unexpected error:", error instanceof Error ? error.message : "unknown");
      throw new Error("We couldn't load tracking right now. Please try again.");
    }
  });


/**
 * Link a shipment created manually in the Shiprocket seller dashboard.
 * This function does not call Shiprocket and cannot create/book a shipment.
 * AWB is the primary key used by Shiprocket tracking webhooks; shipment/order IDs
 * are stored only as additional references.
 */
export const linkManualShiprocketShipment = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
  .validator(z.object({
    orderId: orderIdSchema,
    awb: z.string().trim().min(6).max(40),
    shipmentId: z.string().trim().max(24).optional().default(""),
    shiprocketOrderId: z.string().trim().max(24).optional().default(""),
    courierName: z.string().trim().max(120).optional().default(""),
  }))
  .handler(async ({ data, context }) => {
    const checked = checkTrackingNumber(data.awb);
    if (!checked.ok || !checked.value) throw new Error(checked.ok ? "Enter an AWB." : checked.message);
    const parseId = (value: string, label: string): number | null => {
      if (!value) return null;
      if (!/^\d{1,18}$/.test(value)) throw new Error(`${label} must contain digits only.`);
      const numberValue = Number(value);
      if (!Number.isSafeInteger(numberValue) || numberValue <= 0) throw new Error(`${label} is outside the supported numeric range.`);
      return numberValue;
    };
    const shipmentId = parseId(data.shipmentId, "Shipment ID");
    const shiprocketOrderId = parseId(data.shiprocketOrderId, "Shiprocket Order ID");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: order, error: orderError } = await supabaseAdmin
      .from("orders")
      .select("id,status")
      .eq("id", data.orderId)
      .maybeSingle();
    if (orderError || !order) throw new Error("YEARTH order could not be found.");
    if (order.status === "Cancelled") throw new Error("A cancelled order cannot be linked to a shipment.");

    const { data: duplicate, error: duplicateError } = await supabaseAdmin
      .from("shiprocket_fulfillments")
      .select("order_id")
      .eq("awb", checked.value)
      .maybeSingle();
    if (duplicateError) throw new Error("Could not verify whether this AWB is already linked.");
    if (duplicate && duplicate.order_id !== order.id) throw new Error("This AWB is already linked to another YEARTH order.");

    const { data: existing, error: existingError } = await supabaseAdmin
      .from("shiprocket_fulfillments")
      .select("awb,shiprocket_shipment_id,shiprocket_order_id,courier_name,fulfilment_status,status_source")
      .eq("order_id", order.id)
      .maybeSingle();
    if (existingError) throw new Error("Shipment record could not be loaded. Apply the shipping status migration first.");

    const timestamp = new Date().toISOString();
    const { error: fulfilmentError } = await supabaseAdmin.from("shiprocket_fulfillments").upsert({
      order_id: order.id,
      awb: checked.value,
      shiprocket_shipment_id: shipmentId ?? (existing?.awb === checked.value ? existing.shiprocket_shipment_id : null),
      shiprocket_order_id: shiprocketOrderId ?? (existing?.awb === checked.value ? existing.shiprocket_order_id : null),
      courier_name: data.courierName || (existing?.awb === checked.value ? existing.courier_name : null),
      fulfilment_status: existing?.awb === checked.value && existing.fulfilment_status && existing.fulfilment_status !== "not_created" ? existing.fulfilment_status : "awb_linked",
      status_source: existing?.awb === checked.value && existing.status_source === "webhook" ? "webhook" : "admin",
      last_tracking_status: existing?.awb === checked.value ? undefined : null,
      last_tracking_status_id: existing?.awb === checked.value ? undefined : null,
      last_tracking_event_at: existing?.awb === checked.value ? undefined : null,
      updated_at: timestamp,
    }, { onConflict: "order_id" });
    if (fulfilmentError) throw new Error("AWB was not saved. Check the shipment status migration and try again.");

    const { error: orderUpdateError } = await context.supabase.from("orders")
      .update({ tracking_number: checked.value, updated_at: timestamp })
      .eq("id", order.id)
      .select("id")
      .single();
    if (orderUpdateError) throw new Error("AWB was linked, but YEARTH could not update the order tracking number. Refresh the admin panel before retrying.");

    if (existing?.awb !== checked.value) {
      const { error: cacheError } = await supabaseAdmin.from("order_shipments").upsert({
        order_id: order.id,
        provider: "shiprocket",
        awb: checked.value,
        current_status: null,
        estimated_delivery: null,
        track_url: null,
        events: [] as unknown as Json,
        last_result: "pending",
        last_attempt_at: null,
        last_synced_at: null,
        updated_at: timestamp,
      }, { onConflict: "order_id" });
      if (cacheError) console.error("[shipping] AWB linked but tracking cache initialization failed:", cacheError.message);
    }

    return { ok: true, awb: checked.value, shipmentId, courierName: data.courierName || null };
  });

/**
 * Create the Shiprocket order directly from YEARTH after the admin confirms the
 * packed parcel measurements. This creates only the Shiprocket order record;
 * courier selection / Ship Now / AWB / pickup remain in the Shiprocket dashboard.
 *
 * A deterministic numeric source reference + a lookup-before-create protects
 * retries from creating duplicate Shiprocket orders. Ambiguous earlier attempts
 * require an explicit admin confirmation after checking Shiprocket Orders → All.
 */
export const createShiprocketOrderDirectly = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
  .validator(z.object({
    orderId: orderIdSchema,
    weightKg: z.number().positive().max(30),
    lengthCm: z.number().positive().max(300),
    breadthCm: z.number().positive().max(300),
    heightCm: z.number().positive().max(300),
    confirmRetryAfterManualCheck: z.boolean().optional().default(false),
  }))
  .handler(async ({ data }) => {
    const [{ supabaseAdmin }, { createShiprocketFulfilmentClient, buildShiprocketReference, validateParcelMeasurements }] = await Promise.all([
      import("@/integrations/supabase/client.server"),
      import("./fulfillment.server"),
    ]);

    const { data: rawOrder, error: orderError } = await supabaseAdmin
      .from("orders")
      .select("*, order_items(*)")
      .eq("id", data.orderId)
      .maybeSingle();
    if (orderError || !rawOrder) throw new Error("YEARTH order could not be found.");
    if (rawOrder.status === "Cancelled") throw new Error("A cancelled YEARTH order cannot be sent to Shiprocket.");
    const paymentMethod = String(rawOrder.payment_method ?? "").toLowerCase();
    const paymentStatus = String(rawOrder.payment_status ?? "").toLowerCase();
    if (paymentMethod !== "cod" && !["paid", "captured", "success", "completed"].includes(paymentStatus)) {
      throw new Error("This online order is not marked as paid. Confirm payment before creating a Shiprocket order.");
    }

    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select("email")
      .eq("id", rawOrder.user_id)
      .maybeSingle();
    let customerEmail = profile?.email?.trim() ?? "";
    if (!customerEmail) {
      const { data: authResult } = await supabaseAdmin.auth.admin.getUserById(rawOrder.user_id);
      customerEmail = authResult.user?.email?.trim() ?? "";
    }
    if (!customerEmail || !customerEmail.includes("@")) {
      throw new Error("The customer profile has no valid email address. Update the customer email before creating the Shiprocket order.");
    }

    const parcel = validateParcelMeasurements({
      weightKg: data.weightKg,
      lengthCm: data.lengthCm,
      breadthCm: data.breadthCm,
      heightCm: data.heightCm,
    });

    const { data: existing, error: existingError } = await supabaseAdmin
      .from("shiprocket_fulfillments")
      .select("shiprocket_order_id,shiprocket_shipment_id,shiprocket_reference,order_create_attempted_at,order_create_error,awb,fulfilment_status")
      .eq("order_id", rawOrder.id)
      .maybeSingle();
    if (existingError) throw new Error("Shiprocket order state could not be loaded. Apply the Shiprocket migrations first.");

    if (existing?.shiprocket_order_id && existing.shiprocket_shipment_id) {
      return {
        ok: true,
        alreadyCreated: true,
        reconciled: false,
        shiprocketOrderId: existing.shiprocket_order_id,
        shiprocketShipmentId: existing.shiprocket_shipment_id,
        sourceReference: existing.shiprocket_reference,
      };
    }
    if (existing?.awb) throw new Error("An AWB is already linked to this order. Shiprocket order creation is already beyond the create stage.");

    const sourceReference = existing?.shiprocket_reference || buildShiprocketReference(rawOrder.id);
    const client = createShiprocketFulfilmentClient();

    // Reconcile before every create attempt, including retries. Shiprocket may
    // have created the order even if a previous HTTP response was interrupted.
    const recovered = await client.findOrderByReference(sourceReference);
    if (recovered?.shiprocketOrderId && recovered.shiprocketShipmentId) {
      const timestamp = new Date().toISOString();
      const { error: reconcileError } = await supabaseAdmin.from("shiprocket_fulfillments").upsert({
        order_id: rawOrder.id,
        shiprocket_reference: sourceReference,
        shiprocket_order_id: recovered.shiprocketOrderId,
        shiprocket_shipment_id: recovered.shiprocketShipmentId,
        parcel_weight_kg: parcel.weightKg,
        parcel_length_cm: parcel.lengthCm,
        parcel_breadth_cm: parcel.breadthCm,
        parcel_height_cm: parcel.heightCm,
        parcel_measured_at: timestamp,
        details_sent_at: timestamp,
        fulfilment_status: "order_created",
        status_source: "admin",
        order_create_error: null,
        updated_at: timestamp,
      }, { onConflict: "order_id" });
      if (reconcileError) throw new Error("A matching Shiprocket order was found, but YEARTH could not save its IDs. Do not create another order; refresh Admin Orders and reconcile again.");
      return { ok: true, alreadyCreated: false, reconciled: true, shiprocketOrderId: recovered.shiprocketOrderId, shiprocketShipmentId: recovered.shiprocketShipmentId, sourceReference };
    }

    if (existing?.order_create_attempted_at) {
      const previousAttemptTime = Date.parse(existing.order_create_attempted_at);
      const previousAttemptIsRecent = Number.isFinite(previousAttemptTime) && Date.now() - previousAttemptTime < 2 * 60 * 1000;
      if (previousAttemptIsRecent && !existing.order_create_error) {
        throw new Error("A Shiprocket create request may still be processing. Wait at least 2 minutes, refresh this order, and check Shiprocket Orders → All before retrying.");
      }
      if (!data.confirmRetryAfterManualCheck) {
        throw new Error(`A previous Shiprocket create attempt was recorded, but no order was found in the API lookup. Check Shiprocket Orders → All using source reference ${sourceReference}. Only after confirming no matching order exists, use “Retry after checking Shiprocket”.`);
      }
    }

    const timestamp = new Date().toISOString();
    // Ensure there is a row first. ignoreDuplicates avoids overwriting an
    // already-created/linked shipment when two admins open the same order.
    const { error: seedError } = await supabaseAdmin.from("shiprocket_fulfillments").upsert({
      order_id: rawOrder.id,
      shiprocket_reference: sourceReference,
      parcel_weight_kg: parcel.weightKg,
      parcel_length_cm: parcel.lengthCm,
      parcel_breadth_cm: parcel.breadthCm,
      parcel_height_cm: parcel.heightCm,
      parcel_measured_at: timestamp,
      fulfilment_status: "parcel_measured",
      status_source: "admin",
      updated_at: timestamp,
    }, { onConflict: "order_id", ignoreDuplicates: true });
    if (seedError) throw new Error("Parcel measurements could not be saved before creating the Shiprocket order.");

    // Atomic claim: only one request can start a first create attempt. A manually
    // confirmed retry must match the exact attempt timestamp previously observed.
    let claimQuery = supabaseAdmin.from("shiprocket_fulfillments").update({
      order_create_attempted_at: timestamp,
      order_create_error: null,
      shiprocket_reference: sourceReference,
      parcel_weight_kg: parcel.weightKg,
      parcel_length_cm: parcel.lengthCm,
      parcel_breadth_cm: parcel.breadthCm,
      parcel_height_cm: parcel.heightCm,
      parcel_measured_at: timestamp,
      updated_at: timestamp,
    }).eq("order_id", rawOrder.id).is("shiprocket_order_id", null);
    if (existing?.order_create_attempted_at) {
      claimQuery = claimQuery.eq("order_create_attempted_at", existing.order_create_attempted_at);
    } else {
      claimQuery = claimQuery.is("order_create_attempted_at", null);
    }
    const { data: claimedRows, error: claimError } = await claimQuery.select("order_id");
    if (claimError) throw new Error("Could not reserve this Shiprocket create attempt. Refresh the order and try again.");
    if (!claimedRows?.length) throw new Error("Another admin request may already be creating this Shiprocket order. Refresh the order before trying again.");

    const orderForShiprocket = {
      id: rawOrder.id,
      order_number: rawOrder.order_number,
      created_at: rawOrder.created_at,
      status: rawOrder.status,
      payment_method: rawOrder.payment_method,
      payment_status: rawOrder.payment_status,
      subtotal: rawOrder.subtotal,
      shipping: rawOrder.shipping,
      discount: rawOrder.discount,
      ship_name: rawOrder.ship_name,
      ship_phone: rawOrder.ship_phone,
      ship_address: rawOrder.ship_address,
      ship_city: rawOrder.ship_city,
      ship_state: rawOrder.ship_state,
      ship_pincode: rawOrder.ship_pincode,
      order_items: (rawOrder.order_items ?? []).map((item) => ({
        id: item.id,
        product_id: item.product_id,
        product_name: item.product_name,
        product_slug: item.product_slug ?? "",
        colour: item.colour,
        size: item.size,
        quantity: item.quantity,
        unit_price: item.unit_price,
      })),
    };

    try {
      const created = await client.createOrder(orderForShiprocket, customerEmail, parcel, sourceReference);
      const completedAt = new Date().toISOString();
      const { error: saveError } = await supabaseAdmin.from("shiprocket_fulfillments").upsert({
        order_id: rawOrder.id,
        shiprocket_reference: sourceReference,
        shiprocket_order_id: created.shiprocketOrderId,
        shiprocket_shipment_id: created.shiprocketShipmentId,
        parcel_weight_kg: parcel.weightKg,
        parcel_length_cm: parcel.lengthCm,
        parcel_breadth_cm: parcel.breadthCm,
        parcel_height_cm: parcel.heightCm,
        parcel_measured_at: completedAt,
        details_sent_at: completedAt,
        order_create_attempted_at: timestamp,
        order_create_error: null,
        fulfilment_status: "order_created",
        status_source: "admin",
        updated_at: completedAt,
      }, { onConflict: "order_id" });
      if (saveError) {
        console.error("[shipping] Shiprocket order was created but YEARTH failed to save its internal IDs:", saveError.message);
        throw new Error("Shiprocket created the order, but YEARTH could not save its IDs. Do not click Create again. Use Check Shiprocket Orders to reconcile this order.");
      }
      return { ok: true, alreadyCreated: false, reconciled: false, shiprocketOrderId: created.shiprocketOrderId, shiprocketShipmentId: created.shiprocketShipmentId, sourceReference };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Shiprocket order creation failed.";
      await supabaseAdmin.from("shiprocket_fulfillments")
        .update({ order_create_error: message.slice(0, 700), updated_at: new Date().toISOString() })
        .eq("order_id", rawOrder.id)
        .eq("order_create_attempted_at", timestamp);
      throw new Error(message);
    }
  });

const shipmentStageSchema = z.enum([
  "processing",
  "ready_to_ship",
  "pickup_scheduled",
  "picked_up",
  "in_transit",
  "out_for_delivery",
  "delivered",
  "ndr_action_required",
  "rto_initiated",
  "cancelled",
]);

/**
 * Admin fallback status. The detailed shipping lifecycle is intentionally stored
 * only in shiprocket_fulfillments.fulfilment_status. Do not write orders.status
 * here: that column is the legacy checkout/payment lifecycle and its database
 * transition rules do not include courier milestones such as Picked up or
 * Out for delivery.
 */
export const setManualShipmentStage = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
  .validator(z.object({ orderId: orderIdSchema, stage: shipmentStageSchema }))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: order, error: orderError } = await supabaseAdmin
      .from("orders")
      .select("id,status")
      .eq("id", data.orderId)
      .maybeSingle();
    if (orderError || !order) throw new Error("YEARTH order could not be found.");

    const legacyStatus = String(order.status ?? "").trim().toLowerCase();
    const stage = data.stage;
    // Preserve terminal-state protection from the store's existing order rules.
    // A normal order can still be marked cancelled/delivered via the shipment
    // lifecycle, without attempting a forbidden legacy status transition.
    if (legacyStatus === "cancelled" && stage !== "cancelled") {
      throw new Error("A cancelled order cannot be moved back into the shipping workflow.");
    }
    if (legacyStatus === "delivered" && stage !== "delivered") {
      throw new Error("A delivered order cannot be moved back into the shipping workflow.");
    }

    const timestamp = new Date().toISOString();
    const { data: existing, error: lookupError } = await supabaseAdmin
      .from("shiprocket_fulfillments")
      .select("order_id")
      .eq("order_id", order.id)
      .maybeSingle();
    if (lookupError) {
      console.error("[shipping] Could not inspect existing fulfilment row:", lookupError.message);
      throw new Error("Shipment status could not be saved. Please check the Shiprocket fulfilment table and try again.");
    }

    // Use UPDATE for an existing row so parcel measurements, Shiprocket IDs,
    // AWB, courier and webhook metadata are never nulled by a partial upsert.
    const result = existing
      ? await supabaseAdmin
          .from("shiprocket_fulfillments")
          .update({ fulfilment_status: stage, status_source: "admin", updated_at: timestamp })
          .eq("order_id", order.id)
      : await supabaseAdmin
          .from("shiprocket_fulfillments")
          .insert({ order_id: order.id, fulfilment_status: stage, status_source: "admin", updated_at: timestamp });

    if (result.error) {
      console.error("[shipping] Could not save manual shipment stage:", result.error.message);
      throw new Error("Shipment status could not be saved. Apply the Shiprocket fulfilment migration and try again.");
    }

    return { ok: true, stage, updatedAt: timestamp, statusSource: "admin" as const };
  });
