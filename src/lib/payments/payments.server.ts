/**
 * Online payment workflow. SERVER ONLY.
 *
 * An order is never marked paid because the browser says so. It is marked paid
 * only after (1) the Razorpay signature is verified with the secret key, and
 * (2) the payment is fetched from Razorpay's API and is "captured" for the same
 * Razorpay order and amount, or (3) a signed Razorpay webhook reports it.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  createRazorpayOrder,
  fetchRazorpayPayment,
  razorpayConfig,
  verifyCheckoutSignature,
  verifyWebhookSignature,
} from "./razorpay.server";

type UserClient = SupabaseClient<Database>;

/** Errors whose message is safe to show the customer. */
export class PaymentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PaymentError";
  }
}

const UNAVAILABLE = "Online payment isn't available right now. Please choose Cash on Delivery.";
const NOT_PAYABLE = "This order can't be paid online any more. Please check My Orders.";
const VERIFY_FAILED =
  "We couldn't confirm your payment. If money was taken, it will be confirmed automatically or refunded. Please check My Orders or contact us.";

export type PaymentOptions = { cod: boolean; online: boolean };

export async function getPaymentOptionsData(): Promise<PaymentOptions> {
  const { data, error } = await supabaseAdmin
    .from("store_settings")
    .select("cod_enabled, razorpay_enabled")
    .eq("id", 1)
    .maybeSingle();
  if (error) {
    console.error("[payments] Could not read store settings:", error.message);
    throw new PaymentError("Payment options could not be loaded. Please try again.");
  }
  return {
    cod: data?.cod_enabled ?? false,
    online: !!razorpayConfig() && (data?.razorpay_enabled ?? false),
  };
}

async function loadOwnOrder(client: UserClient, orderId: string) {
  // The customer's own session: row-level security only returns their orders.
  const { data, error } = await client
    .from("orders")
    .select("id, user_id, order_number, total, status, payment_method, payment_status")
    .eq("id", orderId)
    .maybeSingle();
  if (error) {
    console.error("[payments] Could not load order:", error.message);
    throw new PaymentError("We couldn't load your order. Please try again.");
  }
  return data;
}

export async function startPayment(client: UserClient, userId: string, orderId: string) {
  const config = razorpayConfig();
  if (!config) throw new PaymentError(UNAVAILABLE);
  const order = await loadOwnOrder(client, orderId);
  if (
    !order ||
    order.user_id !== userId ||
    order.payment_method !== "razorpay" ||
    order.status !== "Processing" ||
    order.payment_status === "paid"
  ) {
    throw new PaymentError(NOT_PAYABLE);
  }
  // paise, from the database total (orders.total is stored as text on the live database)
  const amount = Math.round(Number(order.total) * 100);
  if (!Number.isSafeInteger(amount) || amount <= 0) throw new PaymentError(NOT_PAYABLE);
  let providerOrder;
  try {
    providerOrder = await createRazorpayOrder(config, {
      amount,
      receipt: order.order_number,
      notes: { order_id: order.id, order_number: order.order_number },
    });
  } catch (error) {
    console.error(
      "[payments] Razorpay order creation failed:",
      error instanceof Error ? error.message : error,
    );
    throw new PaymentError(UNAVAILABLE);
  }
  if (providerOrder.amount !== amount || providerOrder.currency !== "INR") {
    console.error("[payments] Razorpay order amount mismatch for order", order.id);
    throw new PaymentError(UNAVAILABLE);
  }
  const { error } = await supabaseAdmin.rpc("record_payment_order", {
    p_order: order.id,
    p_user: userId,
    p_provider_order_id: providerOrder.id,
    p_amount: amount,
  });
  if (error) {
    console.error("[payments] Could not record the payment order:", error.message);
    throw new PaymentError(NOT_PAYABLE);
  }
  return {
    keyId: config.keyId,
    razorpayOrderId: providerOrder.id,
    amount,
    currency: "INR" as const,
    orderNumber: order.order_number,
  };
}

export type ConfirmInput = {
  orderId: string;
  razorpayOrderId: string;
  razorpayPaymentId: string;
  razorpaySignature: string;
};

/** 'paid' | 'processing' (captured later, confirmed by webhook) | 'refund_needed'. */
export async function confirmPayment(client: UserClient, userId: string, input: ConfirmInput) {
  const config = razorpayConfig();
  if (!config) throw new PaymentError(UNAVAILABLE);
  if (
    !verifyCheckoutSignature(
      config.keySecret,
      input.razorpayOrderId,
      input.razorpayPaymentId,
      input.razorpaySignature,
    )
  ) {
    console.warn("[payments] Invalid checkout signature for order", input.orderId);
    throw new PaymentError(VERIFY_FAILED);
  }
  const order = await loadOwnOrder(client, input.orderId);
  if (!order || order.user_id !== userId) throw new PaymentError(VERIFY_FAILED);

  const record = await supabaseAdmin
    .from("order_payments")
    .select("order_id, amount")
    .eq("provider_order_id", input.razorpayOrderId)
    .maybeSingle();
  if (record.error || !record.data || record.data.order_id !== order.id) {
    console.error(
      "[payments] Payment record mismatch for order",
      order.id,
      record.error?.message ?? "",
    );
    throw new PaymentError(VERIFY_FAILED);
  }

  let payment;
  try {
    payment = await fetchRazorpayPayment(config, input.razorpayPaymentId);
  } catch (error) {
    console.error(
      "[payments] Could not fetch payment:",
      error instanceof Error ? error.message : error,
    );
    // Signature was valid; the webhook will confirm it if it was captured.
    return { status: "processing" as const };
  }
  if (
    payment.order_id !== input.razorpayOrderId ||
    payment.amount !== record.data.amount ||
    payment.currency !== "INR"
  ) {
    console.error("[payments] Payment does not match its order", order.id);
    throw new PaymentError(VERIFY_FAILED);
  }
  if (payment.status !== "captured") return { status: "processing" as const };

  const marked = await supabaseAdmin.rpc("mark_order_paid", {
    p_provider_order_id: input.razorpayOrderId,
    p_provider_payment_id: payment.id,
    p_amount: payment.amount,
  });
  if (marked.error) {
    console.error("[payments] Could not mark order paid:", marked.error.message);
    return { status: "processing" as const };
  }
  if (marked.data === "order_cancelled") {
    console.error("[payments] REFUND NEEDED (recorded in Admin -> Orders -> Refunds): payment captured for cancelled order", order.id);
    return { status: "refund_needed" as const };
  }
  if (marked.data === "duplicate_payment") {
    console.error("[payments] REFUND NEEDED (recorded in Admin -> Orders -> Refunds): second payment for paid order", order.id);
  }
  return { status: "paid" as const };
}

type WebhookPayment = { id?: unknown; order_id?: unknown; amount?: unknown; status?: unknown };
type WebhookEvent = { event?: unknown; payload?: { payment?: { entity?: WebhookPayment } } };

/** Razorpay webhook. Returns an HTTP status code and short body. */
export async function handleRazorpayWebhook(rawBody: string, signature: string | null) {
  const config = razorpayConfig();
  if (!config?.webhookSecret) return { status: 503, body: "Webhook not configured" };
  if (!signature || !verifyWebhookSignature(config.webhookSecret, rawBody, signature)) {
    return { status: 401, body: "Invalid signature" };
  }
  let event: WebhookEvent;
  try {
    event = JSON.parse(rawBody) as WebhookEvent;
  } catch {
    return { status: 400, body: "Invalid JSON" };
  }
  const entity = event.payload?.payment?.entity;
  const orderId = typeof entity?.order_id === "string" ? entity.order_id : null;
  const paymentId = typeof entity?.id === "string" ? entity.id : null;
  const amount = typeof entity?.amount === "number" ? entity.amount : null;
  if (!orderId || !paymentId) return { status: 200, body: "Ignored" };

  if ((event.event === "payment.captured" || event.event === "order.paid") && amount !== null) {
    const { data, error } = await supabaseAdmin.rpc("mark_order_paid", {
      p_provider_order_id: orderId,
      p_provider_payment_id: paymentId,
      p_amount: amount,
    });
    if (error) {
      console.error("[payments] Webhook could not mark order paid:", error.message);
      return { status: 500, body: "Retry" }; // Razorpay retries failed deliveries
    }
    if (data === "order_cancelled" || data === "duplicate_payment") {
      console.error(
        `[payments] REFUND NEEDED (recorded in Admin -> Orders -> Refunds): ${data === "order_cancelled" ? "captured payment for cancelled order" : "second payment for paid order"} (Razorpay order)`,
        orderId,
      );
    }
    return { status: 200, body: "OK" };
  }
  if (event.event === "payment.failed") {
    const { error } = await supabaseAdmin.rpc("mark_payment_failed", {
      p_provider_order_id: orderId,
      p_provider_payment_id: paymentId,
    });
    if (error) {
      console.error("[payments] Webhook could not record failure:", error.message);
      return { status: 500, body: "Retry" };
    }
  }
  return { status: 200, body: "OK" };
}

export async function expireUnpaidOrders() {
  const { data, error } = await supabaseAdmin.rpc("expire_unpaid_orders", { p_minutes: 45 });
  if (error) {
    console.error("[payments] Expiry job failed:", error.message);
    return { status: 500, expired: 0 };
  }
  return { status: 200, expired: data ?? 0 };
}
