/**
 * Razorpay helpers. SERVER ONLY: never import this file from browser code.
 * Secrets are read from server environment variables and never returned to the
 * browser or written to logs.
 *
 *   RAZORPAY_KEY_ID          public key id (also sent to the browser checkout)
 *   RAZORPAY_KEY_SECRET      secret key: signs/verifies checkout payments
 *   RAZORPAY_WEBHOOK_SECRET  secret set on the Razorpay webhook
 */
import { createHmac, timingSafeEqual } from "node:crypto";

export type RazorpayConfig = { keyId: string; keySecret: string; webhookSecret: string | null };

/** null when online payments are not configured on this server. */
export function razorpayConfig(
  env: Record<string, string | undefined> = process.env,
): RazorpayConfig | null {
  const keyId = env["RAZORPAY_KEY_ID"]?.trim();
  const keySecret = env["RAZORPAY_KEY_SECRET"]?.trim();
  if (!keyId || !keySecret) return null;
  return { keyId, keySecret, webhookSecret: env["RAZORPAY_WEBHOOK_SECRET"]?.trim() || null };
}

export function hmacSha256Hex(secret: string, payload: string) {
  return createHmac("sha256", secret).update(payload, "utf8").digest("hex");
}

/** Constant-time comparison of two hex signatures. */
export function signaturesMatch(expectedHex: string, receivedHex: string) {
  const a = Buffer.from(expectedHex, "utf8");
  const b = Buffer.from(receivedHex, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Signature returned by Razorpay Checkout: HMAC_SHA256(order_id + "|" + payment_id, key_secret). */
export function verifyCheckoutSignature(
  keySecret: string,
  razorpayOrderId: string,
  razorpayPaymentId: string,
  signature: string,
) {
  return signaturesMatch(
    hmacSha256Hex(keySecret, `${razorpayOrderId}|${razorpayPaymentId}`),
    signature,
  );
}

/** Webhook signature: HMAC_SHA256(raw request body, webhook_secret), header X-Razorpay-Signature. */
export function verifyWebhookSignature(webhookSecret: string, rawBody: string, signature: string) {
  return signaturesMatch(hmacSha256Hex(webhookSecret, rawBody), signature);
}

export class RazorpayApiError extends Error {
  constructor(
    readonly path: string,
    readonly status: number,
    readonly razorpayCode: string | null,
  ) {
    super(
      `Razorpay request ${path} failed (HTTP ${status}${razorpayCode ? `, ${razorpayCode}` : ""})`,
    );
    this.name = "RazorpayApiError";
  }
}

async function razorpayRequest<T>(
  config: RazorpayConfig,
  method: "GET" | "POST",
  path: string,
  body?: Record<string, unknown>,
  extraHeaders: Record<string, string> = {},
): Promise<T> {
  const auth = Buffer.from(`${config.keyId}:${config.keySecret}`).toString("base64");
  const init: RequestInit = {
    method,
    headers: { ...extraHeaders, Authorization: `Basic ${auth}`, "Content-Type": "application/json" },
    signal: AbortSignal.timeout(15_000),
  };
  if (body) init.body = JSON.stringify(body);
  const response = await fetch(`https://api.razorpay.com/v1${path}`, init);
  if (!response.ok) {
    let code: string | null = null;
    try {
      const data = (await response.json()) as { error?: { code?: unknown } };
      code = typeof data.error?.code === "string" ? data.error.code : null;
    } catch {
      code = null;
    }
    throw new RazorpayApiError(path, response.status, code);
  }
  return (await response.json()) as T;
}

export type RazorpayOrder = { id: string; amount: number; currency: string; status: string };
export type RazorpayPayment = {
  id: string;
  order_id: string | null;
  amount: number;
  currency: string;
  status: "created" | "authorized" | "captured" | "refunded" | "failed";
};

export function createRazorpayOrder(
  config: RazorpayConfig,
  input: { amount: number; receipt: string; notes: Record<string, string> },
) {
  return razorpayRequest<RazorpayOrder>(config, "POST", "/orders", {
    amount: input.amount,
    currency: "INR",
    receipt: input.receipt.slice(0, 40),
    notes: input.notes,
  });
}

export function fetchRazorpayPayment(config: RazorpayConfig, paymentId: string) {
  if (!/^pay_[A-Za-z0-9]+$/.test(paymentId)) throw new Error("Invalid payment id");
  return razorpayRequest<RazorpayPayment>(config, "GET", `/payments/${paymentId}`);
}

export type RazorpayRefund = {
  id: string;
  entity: string;
  amount: number;
  currency: string;
  payment_id: string;
  status: "pending" | "processed" | "failed";
};

const PAYMENT_ID = /^pay_[A-Za-z0-9]+$/;
const REFUND_ID = /^rfnd_[A-Za-z0-9]+$/;

/**
 * Full refund of a captured payment. `idempotencyKey` is sent as Razorpay's
 * X-Refund-Idempotency header: retrying with the same key and the same body
 * cannot refund twice (https://razorpay.com/docs/api/refunds/normal-refunds-idempotent).
 */
export function createRazorpayRefund(
  config: RazorpayConfig,
  paymentId: string,
  input: { amount: number; idempotencyKey: string; receipt: string; notes: Record<string, string> },
) {
  if (!PAYMENT_ID.test(paymentId)) throw new Error("Invalid payment id");
  if (!/^[A-Za-z0-9_-]{10,}$/.test(input.idempotencyKey)) throw new Error("Invalid idempotency key");
  return razorpayRequest<RazorpayRefund>(
    config,
    "POST",
    `/payments/${paymentId}/refund`,
    { amount: input.amount, speed: "normal", receipt: input.receipt.slice(0, 40), notes: input.notes },
    { "X-Refund-Idempotency": input.idempotencyKey },
  );
}

export function fetchRazorpayRefund(config: RazorpayConfig, refundId: string) {
  if (!REFUND_ID.test(refundId)) throw new Error("Invalid refund id");
  return razorpayRequest<RazorpayRefund>(config, "GET", `/refunds/${refundId}`);
}

/** Refunds already made for a payment (up to 100). */
export async function listRazorpayRefunds(config: RazorpayConfig, paymentId: string) {
  if (!PAYMENT_ID.test(paymentId)) throw new Error("Invalid payment id");
  const data = await razorpayRequest<{ items?: RazorpayRefund[] }>(
    config,
    "GET",
    `/payments/${paymentId}/refunds?count=100`,
  );
  return Array.isArray(data.items) ? data.items : [];
}
