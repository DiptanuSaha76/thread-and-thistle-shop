import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { hmacSha256Hex } from "./razorpay.server";

// The service-role client is replaced by a recorder: no real database is used.
const rpc = vi.fn();
const fromResult = { data: null as unknown, error: null as unknown };
vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    rpc: (...args: unknown[]) => rpc(...args),
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => fromResult }) }),
    }),
  },
}));

const { confirmPayment, handleRazorpayWebhook, PaymentError, startPayment } =
  await import("./payments.server");

const ENV = {
  RAZORPAY_KEY_ID: "rzp_test_key",
  RAZORPAY_KEY_SECRET: "key_secret",
  RAZORPAY_WEBHOOK_SECRET: "whsec",
};
const ORDER_ID = "11111111-1111-4111-8111-111111111111";
const USER_ID = "22222222-2222-4222-8222-222222222222";

/** A fake customer session client that returns `order` for the customer's own order query. */
const userClient = (order: Record<string, unknown> | null) =>
  ({
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: order, error: null }) }) }),
    }),
  }) as never;
const ownOrder = {
  id: ORDER_ID,
  user_id: USER_ID,
  order_number: "YE1001",
  total: 1438,
  status: "Processing",
  payment_method: "razorpay",
  payment_status: "pending",
};

beforeEach(() => {
  for (const [k, v] of Object.entries(ENV)) process.env[k] = v;
  rpc.mockReset();
  fromResult.data = null;
  fromResult.error = null;
});
afterEach(() => {
  for (const k of Object.keys(ENV)) delete process.env[k];
  vi.unstubAllGlobals();
});

describe("webhook", () => {
  const body = (event: string, entity: Record<string, unknown>) =>
    JSON.stringify({ event, payload: { payment: { entity } } });
  const sign = (raw: string) => hmacSha256Hex(ENV.RAZORPAY_WEBHOOK_SECRET, raw);

  it("is disabled (503) until the webhook secret is configured", async () => {
    delete process.env["RAZORPAY_WEBHOOK_SECRET"];
    expect((await handleRazorpayWebhook("{}", "x")).status).toBe(503);
    expect(rpc).not.toHaveBeenCalled();
  });
  it("rejects unsigned or wrongly signed requests and changes nothing", async () => {
    const raw = body("payment.captured", { id: "pay_1", order_id: "order_1", amount: 143800 });
    expect((await handleRazorpayWebhook(raw, null)).status).toBe(401);
    expect((await handleRazorpayWebhook(raw, sign(raw + " "))).status).toBe(401);
    expect(rpc).not.toHaveBeenCalled();
  });
  it("marks the order paid for a signed payment.captured event", async () => {
    rpc.mockResolvedValue({ data: "paid", error: null });
    const raw = body("payment.captured", { id: "pay_1", order_id: "order_1", amount: 143800 });
    expect((await handleRazorpayWebhook(raw, sign(raw))).status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("mark_order_paid", {
      p_provider_order_id: "order_1",
      p_provider_payment_id: "pay_1",
      p_amount: 143800,
    });
  });
  it("asks Razorpay to retry when the database is unavailable", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "connection refused" } });
    const raw = body("order.paid", { id: "pay_1", order_id: "order_1", amount: 100 });
    expect((await handleRazorpayWebhook(raw, sign(raw))).status).toBe(500);
  });
  it("records failed payments without marking anything paid", async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    const raw = body("payment.failed", { id: "pay_2", order_id: "order_2", amount: 100 });
    expect((await handleRazorpayWebhook(raw, sign(raw))).status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("mark_payment_failed", {
      p_provider_order_id: "order_2",
      p_provider_payment_id: "pay_2",
    });
  });
  it("ignores unrelated events", async () => {
    const raw = JSON.stringify({ event: "refund.created", payload: {} });
    expect((await handleRazorpayWebhook(raw, sign(raw))).status).toBe(200);
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe("starting a payment", () => {
  it("refuses when online payments are not configured", async () => {
    delete process.env["RAZORPAY_KEY_SECRET"];
    await expect(startPayment(userClient(ownOrder), USER_ID, ORDER_ID)).rejects.toBeInstanceOf(
      PaymentError,
    );
  });
  it("refuses orders that are not the customer's own unpaid online order", async () => {
    for (const order of [
      null,
      { ...ownOrder, user_id: "someone-else" },
      { ...ownOrder, payment_status: "paid" },
      { ...ownOrder, payment_method: "cod" },
      { ...ownOrder, status: "Cancelled" },
    ]) {
      await expect(startPayment(userClient(order), USER_ID, ORDER_ID)).rejects.toBeInstanceOf(
        PaymentError,
      );
    }
  });
  it("charges a database total stored as text", async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({ id: "order_RP2", amount: 143800, currency: "INR", status: "created" }),
    );
    vi.stubGlobal("fetch", fetchMock);
    rpc.mockResolvedValue({ data: null, error: null });
    await startPayment(userClient({ ...ownOrder, total: "1438" }), USER_ID, ORDER_ID);
    const sent = JSON.parse(
      String((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body),
    );
    expect(sent.amount).toBe(143800);
  });
  it("refuses an order whose stored total is not a number", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(
      startPayment(userClient({ ...ownOrder, total: "abc" }), USER_ID, ORDER_ID),
    ).rejects.toBeInstanceOf(PaymentError);
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("charges the database total, not a browser value", async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({ id: "order_RP1", amount: 143800, currency: "INR", status: "created" }),
    );
    vi.stubGlobal("fetch", fetchMock);
    rpc.mockResolvedValue({ data: null, error: null });
    const session = await startPayment(userClient(ownOrder), USER_ID, ORDER_ID);
    const sent = JSON.parse(
      String((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body),
    );
    expect(sent.amount).toBe(143800);
    expect(session).toMatchObject({
      keyId: "rzp_test_key",
      razorpayOrderId: "order_RP1",
      amount: 143800,
    });
    expect(JSON.stringify(session)).not.toContain("key_secret");
    expect(rpc).toHaveBeenCalledWith("record_payment_order", {
      p_order: ORDER_ID,
      p_user: USER_ID,
      p_provider_order_id: "order_RP1",
      p_amount: 143800,
    });
  });
});

describe("confirming a payment", () => {
  const input = (signature: string) => ({
    orderId: ORDER_ID,
    razorpayOrderId: "order_RP1",
    razorpayPaymentId: "pay_P1",
    razorpaySignature: signature,
  });
  const validSig = hmacSha256Hex(ENV.RAZORPAY_KEY_SECRET, "order_RP1|pay_P1");
  const payment = (overrides: Record<string, unknown> = {}) =>
    Response.json({
      id: "pay_P1",
      order_id: "order_RP1",
      amount: 143800,
      currency: "INR",
      status: "captured",
      ...overrides,
    });

  it("never marks paid on a forged browser callback", async () => {
    await expect(
      confirmPayment(userClient(ownOrder), USER_ID, input("0".repeat(64))),
    ).rejects.toBeInstanceOf(PaymentError);
    expect(rpc).not.toHaveBeenCalled();
  });
  it("rejects a valid signature for a payment record belonging to another order", async () => {
    fromResult.data = { order_id: "33333333-3333-4333-8333-333333333333", amount: 143800 };
    await expect(
      confirmPayment(userClient(ownOrder), USER_ID, input(validSig)),
    ).rejects.toBeInstanceOf(PaymentError);
    expect(rpc).not.toHaveBeenCalled();
  });
  it("rejects when Razorpay reports a different amount", async () => {
    fromResult.data = { order_id: ORDER_ID, amount: 143800 };
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => payment({ amount: 100 })),
    );
    await expect(
      confirmPayment(userClient(ownOrder), USER_ID, input(validSig)),
    ).rejects.toBeInstanceOf(PaymentError);
    expect(rpc).not.toHaveBeenCalled();
  });
  it("waits for capture instead of marking an authorised payment paid", async () => {
    fromResult.data = { order_id: ORDER_ID, amount: 143800 };
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => payment({ status: "authorized" })),
    );
    expect(await confirmPayment(userClient(ownOrder), USER_ID, input(validSig))).toEqual({
      status: "processing",
    });
    expect(rpc).not.toHaveBeenCalled();
  });
  it("marks paid only after signature + API checks pass", async () => {
    fromResult.data = { order_id: ORDER_ID, amount: 143800 };
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => payment()),
    );
    rpc.mockResolvedValue({ data: "paid", error: null });
    expect(await confirmPayment(userClient(ownOrder), USER_ID, input(validSig))).toEqual({
      status: "paid",
    });
    expect(rpc).toHaveBeenCalledWith("mark_order_paid", {
      p_provider_order_id: "order_RP1",
      p_provider_payment_id: "pay_P1",
      p_amount: 143800,
    });
  });
  it("reports refunds needed for payments on expired orders", async () => {
    fromResult.data = { order_id: ORDER_ID, amount: 143800 };
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => payment()),
    );
    rpc.mockResolvedValue({ data: "order_cancelled", error: null });
    expect(await confirmPayment(userClient(ownOrder), USER_ID, input(validSig))).toEqual({
      status: "refund_needed",
    });
  });
});
