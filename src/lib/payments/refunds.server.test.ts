import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The service-role client and Razorpay are both fakes: no database, no real refund.
const rpc = vi.fn();
const caseRow = {
  id: "33333333-3333-4333-8333-333333333333",
  order_id: "11111111-1111-4111-8111-111111111111",
  provider_payment_id: "pay_OK1",
  amount: 159800,
  currency: "INR",
  status: "refund_requested",
  provider_refund_id: null as string | null,
};
vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    rpc: (...args: unknown[]) => rpc(...args),
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { ...caseRow }, error: null }) }) }) }),
  },
}));
const { startRefund, checkRefund, recordDashboardRefund, RefundError } = await import("./refunds.server");

const ENV = { RAZORPAY_KEY_ID: "rzp_test_key", RAZORPAY_KEY_SECRET: "key_secret_not_real", RAZORPAY_WEBHOOK_SECRET: "whsec" };
const ADMIN = "a0000000-0000-4000-8000-00000000000a";
const refund = (over: Record<string, unknown> = {}) => ({ id: "rfnd_R1", entity: "refund", amount: 159800, currency: "INR", payment_id: "pay_OK1", status: "processed", ...over });
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });

type Route = (url: string, init: RequestInit) => Response | Promise<Response>;
function razorpay(routes: { list?: Route; create?: Route; fetchOne?: Route }) {
  const calls: { url: string; init: RequestInit }[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    if (url.includes("/refunds?")) return (routes.list ?? (() => json(200, { entity: "collection", count: 0, items: [] })))(url, init);
    if (url.endsWith("/refund")) return (routes.create ?? (() => json(200, refund())))(url, init);
    if (url.includes("/refunds/")) return (routes.fetchOne ?? (() => json(200, refund())))(url, init);
    return json(404, {});
  }));
  return calls;
}
const begin = (reply: unknown) => (name: string) =>
  name === "refund_begin" ? { data: reply, error: null } : name === "refund_record" ? { data: "refunded", error: null } : { data: null, error: null };
const okBegin = { ok: true, provider_payment_id: "pay_OK1", amount: 159800, currency: "INR", order_id: caseRow.order_id, idempotency_key: caseRow.id, retry: false };

beforeEach(() => {
  for (const [k, v] of Object.entries(ENV)) process.env[k] = v;
  rpc.mockReset();
  caseRow.status = "refund_requested";
  caseRow.provider_refund_id = null;
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  for (const k of Object.keys(ENV)) delete process.env[k];
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("startRefund", () => {
  it("checks for an earlier refund, then sends one full refund with the idempotency key", async () => {
    rpc.mockImplementation(begin(okBegin));
    const calls = razorpay({});
    await expect(startRefund(caseRow.id, ADMIN)).resolves.toEqual({ status: "refunded", refundId: "rfnd_R1" });
    expect(calls.map((c) => [c.init.method, c.url])).toEqual([
      ["GET", "https://api.razorpay.com/v1/payments/pay_OK1/refunds?count=100"],
      ["POST", "https://api.razorpay.com/v1/payments/pay_OK1/refund"],
    ]);
    const create = calls[1]!;
    expect(new Headers(create.init.headers).get("X-Refund-Idempotency")).toBe(caseRow.id);
    expect(JSON.parse(String(create.init.body))).toMatchObject({ amount: 159800, speed: "normal", notes: { refund_case: caseRow.id } });
    expect(rpc).toHaveBeenCalledWith("refund_record", { p_case: caseRow.id, p_refund_id: "rfnd_R1", p_amount: 159800, p_provider_status: "processed", p_admin: ADMIN });
  });

  it("finds an earlier refund (e.g. after a lost answer) instead of refunding again", async () => {
    rpc.mockImplementation(begin({ ...okBegin, retry: true }));
    const calls = razorpay({ list: () => json(200, { items: [refund({ id: "rfnd_EARLY", status: "pending" })] }) });
    await startRefund(caseRow.id, ADMIN);
    expect(calls.some((c) => c.url.endsWith("/refund"))).toBe(false);
    expect(rpc).toHaveBeenCalledWith("refund_record", expect.objectContaining({ p_refund_id: "rfnd_EARLY", p_provider_status: "pending" }));
  });

  it("ignores failed or partial earlier refunds when deciding", async () => {
    rpc.mockImplementation(begin(okBegin));
    const calls = razorpay({ list: () => json(200, { items: [refund({ id: "rfnd_F", status: "failed" }), refund({ id: "rfnd_P", amount: 100 })] }) });
    await startRefund(caseRow.id, ADMIN);
    expect(calls.filter((c) => c.url.endsWith("/refund"))).toHaveLength(1);
  });

  it("on a timeout leaves the case 'requested' (not failed) and a retry reuses the same key", async () => {
    rpc.mockImplementation(begin(okBegin));
    let attempt = 0;
    const calls = razorpay({
      create: () => {
        attempt += 1;
        if (attempt === 1) throw Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" });
        return json(200, refund());
      },
    });
    await expect(startRefund(caseRow.id, ADMIN)).rejects.toThrow(/safe to press Refund again/);
    expect(rpc).not.toHaveBeenCalledWith("refund_mark_failed", expect.anything());
    await expect(startRefund(caseRow.id, ADMIN)).resolves.toMatchObject({ status: "refunded" });
    const keys = calls.filter((c) => c.url.endsWith("/refund")).map((c) => new Headers(c.init.headers).get("X-Refund-Idempotency"));
    expect(keys).toEqual([caseRow.id, caseRow.id]);
  });

  it.each([
    [500, "SERVER_ERROR"],
    [409, "BAD_REQUEST_ERROR"],
    [429, "TOO_MANY_REQUESTS"],
  ])("HTTP %i is treated as 'outcome unknown', not failed", async (status, code) => {
    rpc.mockImplementation(begin(okBegin));
    razorpay({ create: () => json(status, { error: { code } }) });
    await expect(startRefund(caseRow.id, ADMIN)).rejects.toThrow(/will not refund twice/);
    expect(rpc).not.toHaveBeenCalledWith("refund_mark_failed", expect.anything());
  });

  it("a definite refusal marks the case failed with Razorpay's code", async () => {
    rpc.mockImplementation(begin(okBegin));
    razorpay({ create: () => json(400, { error: { code: "BAD_REQUEST_ERROR", description: "The payment has been fully refunded already" } }) });
    await expect(startRefund(caseRow.id, ADMIN)).rejects.toThrow(/refused the refund \(BAD_REQUEST_ERROR\)/);
    expect(rpc).toHaveBeenCalledWith("refund_mark_failed", { p_case: caseRow.id, p_error: "Refused by Razorpay (BAD_REQUEST_ERROR)" });
  });

  it("does not send a refund when existing refunds cannot be checked", async () => {
    rpc.mockImplementation(begin(okBegin));
    const calls = razorpay({ list: () => json(503, {}) });
    await expect(startRefund(caseRow.id, ADMIN)).rejects.toThrow(/did not confirm/);
    expect(calls.some((c) => c.url.endsWith("/refund"))).toBe(false);
  });

  it("does not record a refund that belongs to another payment", async () => {
    rpc.mockImplementation(begin(okBegin));
    razorpay({ create: () => json(200, refund({ payment_id: "pay_OTHER" })) });
    await expect(startRefund(caseRow.id, ADMIN)).rejects.toThrow(/different payment/);
    expect(rpc).not.toHaveBeenCalledWith("refund_record", expect.anything());
  });

  it("makes no Razorpay call for finished or failed cases", async () => {
    const calls = razorpay({});
    rpc.mockImplementation(begin({ ok: false, reason: "ALREADY_DONE", status: "refunded" }));
    await expect(startRefund(caseRow.id, ADMIN)).resolves.toMatchObject({ status: "refunded" });
    rpc.mockImplementation(begin({ ok: false, reason: "FAILED" }));
    await expect(startRefund(caseRow.id, ADMIN)).rejects.toBeInstanceOf(RefundError);
    expect(calls).toHaveLength(0);
  });

  it("refuses when Razorpay is not configured", async () => {
    delete process.env["RAZORPAY_KEY_SECRET"];
    const calls = razorpay({});
    await expect(startRefund(caseRow.id, ADMIN)).rejects.toThrow(/not configured/);
    expect(rpc).not.toHaveBeenCalled();
    expect(calls).toHaveLength(0);
  });

  it("never logs the key secret", async () => {
    rpc.mockImplementation(begin(okBegin));
    razorpay({ create: () => json(500, {}) });
    await startRefund(caseRow.id, ADMIN).catch(() => {});
    const logged = (console.error as unknown as ReturnType<typeof vi.fn>).mock.calls.flat().join(" ");
    expect(logged).not.toContain("key_secret_not_real");
    expect(logged).not.toContain(Buffer.from("rzp_test_key:key_secret_not_real").toString("base64"));
  });
});

describe("checkRefund and recordDashboardRefund", () => {
  it("refreshes a known refund from Razorpay", async () => {
    caseRow.provider_refund_id = "rfnd_R1";
    rpc.mockImplementation(begin(okBegin));
    const calls = razorpay({ fetchOne: () => json(200, refund({ status: "processed" })) });
    await expect(checkRefund(caseRow.id, ADMIN)).resolves.toEqual({ status: "refunded", refundId: "rfnd_R1" });
    expect(calls[0]!.url).toBe("https://api.razorpay.com/v1/refunds/rfnd_R1");
  });
  it("verifies a dashboard refund ID with Razorpay before recording it", async () => {
    rpc.mockImplementation(begin(okBegin));
    razorpay({ fetchOne: () => json(404, { error: { code: "BAD_REQUEST_ERROR" } }) });
    await expect(recordDashboardRefund(caseRow.id, "rfnd_NOPE", ADMIN)).rejects.toThrow(/no refund with that ID/);
    razorpay({ fetchOne: () => json(200, refund({ payment_id: "pay_OTHER" })) });
    await expect(recordDashboardRefund(caseRow.id, "rfnd_X", ADMIN)).rejects.toThrow(/different payment/);
    expect(rpc).not.toHaveBeenCalledWith("refund_record", expect.anything());
  });
  it("shows the database's reason when a refund is not a full refund", async () => {
    rpc.mockImplementation((name: string) => (name === "refund_record" ? { data: null, error: { message: "REFUND_AMOUNT_MISMATCH" } } : { data: null, error: null }));
    razorpay({ fetchOne: () => json(200, refund({ amount: 100 })) });
    await expect(recordDashboardRefund(caseRow.id, "rfnd_R1", ADMIN)).rejects.toThrow(/not for the full payment amount/);
  });
});
