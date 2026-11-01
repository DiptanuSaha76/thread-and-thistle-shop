/**
 * Refunds of Razorpay payments. SERVER ONLY. Called only from admin server
 * functions, after the database admin check.
 *
 * Safety:
 * - Refund cases are created by the database (cancelled paid orders, late and
 *   duplicate payments); this code never decides that money is owed.
 * - Refunds are always for the full payment, started by an admin, never automatically.
 * - Before asking Razorpay for a refund, existing refunds for the payment are
 *   checked, so an earlier attempt whose answer was lost is found, not repeated.
 * - The refund request carries Razorpay's idempotency key (the case id), so a
 *   retried request cannot refund twice. Razorpay also refuses refunds above
 *   the captured amount.
 * - A timeout or Razorpay outage leaves the case "requested" (outcome unknown);
 *   only a definite refusal marks it failed.
 * - Every refund recorded is first fetched from Razorpay and must belong to the
 *   same payment, in INR, for the full amount.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  createRazorpayRefund,
  fetchRazorpayRefund,
  listRazorpayRefunds,
  RazorpayApiError,
  razorpayConfig,
  type RazorpayRefund,
} from "./razorpay.server";

/** Errors whose message is safe to show the admin. */
export class RefundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RefundError";
  }
}

export type RefundResult = { status: string; refundId: string | null };

type CaseRow = {
  id: string;
  order_id: string;
  provider_payment_id: string;
  amount: number;
  currency: string;
  status: string;
  provider_refund_id: string | null;
};

const UNCONFIRMED =
  "Razorpay did not confirm the refund (timeout or service problem). It is safe to press Refund again: it will not refund twice.";

const dbMessages: Record<string, string> = {
  REFUND_AMOUNT_MISMATCH:
    "That refund is not for the full payment amount. Partial refunds are not tracked here; complete the refund in Razorpay or close the case manually with a note.",
  REFUND_ALREADY_RECORDED: "A different refund is already recorded for this payment.",
  REFUND_ID_IN_USE: "That refund ID is already recorded for another payment.",
  REFUND_NOT_RESOLVABLE:
    "This refund may already be in progress at Razorpay. Use 'Check status' first.",
  NOTE_REQUIRED: "Please add a short note explaining how the customer was refunded.",
  REFUND_CASE_NOT_FOUND: "Refund case not found.",
};

function config() {
  const c = razorpayConfig();
  if (!c) throw new RefundError("Razorpay is not configured on the server.");
  return c;
}

async function loadCase(caseId: string): Promise<CaseRow> {
  const { data, error } = await supabaseAdmin
    .from("payment_refunds")
    .select("id, order_id, provider_payment_id, amount, currency, status, provider_refund_id")
    .eq("id", caseId)
    .maybeSingle();
  if (error) {
    console.error("[refunds] Could not load refund case:", error.message);
    throw new RefundError("The refund could not be loaded. Please try again.");
  }
  if (!data) throw new RefundError("Refund case not found.");
  return data;
}

/** Checks a refund from Razorpay belongs to this case's payment before it is recorded. */
function matches(row: CaseRow, refund: RazorpayRefund) {
  return (
    refund.entity === "refund" &&
    refund.payment_id === row.provider_payment_id &&
    refund.currency === row.currency
  );
}

async function record(row: CaseRow, refund: RazorpayRefund, adminId: string): Promise<RefundResult> {
  if (!matches(row, refund)) throw new RefundError("That refund belongs to a different payment.");
  const { data, error } = await supabaseAdmin.rpc("refund_record", {
    p_case: row.id,
    p_refund_id: refund.id,
    p_amount: refund.amount,
    p_provider_status: refund.status,
    p_admin: adminId,
  });
  if (error) {
    console.error("[refunds] Could not record refund:", error.message);
    throw new RefundError(dbMessages[error.message] ?? "The refund could not be saved. Please try again.");
  }
  return { status: String(data), refundId: refund.id };
}

/** A full, non-failed refund already made at Razorpay for this payment, if any. */
async function existingRefund(row: CaseRow) {
  const refunds = await listRazorpayRefunds(config(), row.provider_payment_id);
  return (
    refunds.find((r) => matches(row, r) && r.amount === row.amount && r.status !== "failed") ?? null
  );
}

const isDefiniteRefusal = (error: unknown) =>
  error instanceof RazorpayApiError &&
  error.status >= 400 &&
  error.status < 500 &&
  error.status !== 401 && // our credentials, not the refund
  error.status !== 408 &&
  error.status !== 409 && // same key still in progress
  error.status !== 429;

/** Admin "Refund via Razorpay". */
export async function startRefund(caseId: string, adminId: string): Promise<RefundResult> {
  const cfg = config();
  const { data, error } = await supabaseAdmin.rpc("refund_begin", { p_case: caseId, p_admin: adminId });
  if (error) {
    console.error("[refunds] Could not start refund:", error.message);
    throw new RefundError("The refund could not be started. Please try again.");
  }
  const begun = (data ?? {}) as Record<string, unknown>;
  if (begun["ok"] !== true) {
    if (begun["reason"] === "ALREADY_DONE")
      return { status: String(begun["status"]), refundId: (await loadCase(caseId)).provider_refund_id };
    if (begun["reason"] === "FAILED")
      throw new RefundError(
        "Razorpay refused this refund earlier. Refund the customer another way, then close the case with a note.",
      );
    throw new RefundError("Refund case not found.");
  }
  const row = await loadCase(caseId);

  try {
    const earlier = await existingRefund(row);
    if (earlier) return await record(row, earlier, adminId);
  } catch (lookupError) {
    if (lookupError instanceof RefundError) throw lookupError;
    // Without knowing whether an earlier attempt succeeded, do not send another request.
    console.error("[refunds] Could not list existing refunds:", describe(lookupError));
    throw new RefundError(UNCONFIRMED);
  }

  let refund: RazorpayRefund;
  try {
    refund = await createRazorpayRefund(cfg, row.provider_payment_id, {
      amount: row.amount,
      idempotencyKey: String(begun["idempotency_key"]),
      receipt: `refund-${row.id.slice(0, 8)}`,
      notes: { refund_case: row.id, order_id: row.order_id },
    });
  } catch (requestError) {
    console.error("[refunds] Refund request failed:", describe(requestError));
    if (isDefiniteRefusal(requestError)) {
      const code = (requestError as RazorpayApiError).razorpayCode ?? `HTTP ${(requestError as RazorpayApiError).status}`;
      await supabaseAdmin.rpc("refund_mark_failed", { p_case: row.id, p_error: `Refused by Razorpay (${code})` });
      throw new RefundError(
        `Razorpay refused the refund (${code}). Check the payment in the Razorpay dashboard; if it was refunded there, record its refund ID, otherwise close the case with a note after refunding another way.`,
      );
    }
    throw new RefundError(UNCONFIRMED);
  }
  return record(row, refund, adminId);
}

/** Admin "Check status": refreshes a requested or pending refund from Razorpay. */
export async function checkRefund(caseId: string, adminId: string): Promise<RefundResult> {
  const row = await loadCase(caseId);
  try {
    if (row.provider_refund_id) return await record(row, await fetchRazorpayRefund(config(), row.provider_refund_id), adminId);
    const earlier = await existingRefund(row);
    if (earlier) return await record(row, earlier, adminId);
  } catch (error) {
    if (error instanceof RefundError) throw error;
    console.error("[refunds] Could not check refund:", describe(error));
    throw new RefundError("Razorpay could not be reached. Please try again in a minute.");
  }
  return { status: row.status, refundId: null };
}

/** Admin records a refund made in the Razorpay dashboard; it is verified with Razorpay first. */
export async function recordDashboardRefund(caseId: string, refundId: string, adminId: string) {
  const row = await loadCase(caseId);
  let refund: RazorpayRefund;
  try {
    refund = await fetchRazorpayRefund(config(), refundId);
  } catch (error) {
    if (error instanceof RefundError) throw error;
    console.error("[refunds] Could not fetch refund:", describe(error));
    throw new RefundError(
      error instanceof RazorpayApiError && error.status === 404
        ? "Razorpay has no refund with that ID."
        : "Razorpay could not be reached. Please try again in a minute.",
    );
  }
  return record(row, refund, adminId);
}

/** Admin closes a case after refunding outside Razorpay (e.g. bank transfer), with a note. */
export async function resolveRefundManually(caseId: string, note: string, adminId: string) {
  const { error } = await supabaseAdmin.rpc("refund_resolve_manually", {
    p_case: caseId,
    p_admin: adminId,
    p_note: note,
  });
  if (error) {
    console.error("[refunds] Could not close refund case:", error.message);
    throw new RefundError(dbMessages[error.message] ?? "The case could not be closed. Please try again.");
  }
  return { status: "resolved_manually", refundId: null };
}

function describe(error: unknown) {
  if (error instanceof RazorpayApiError) return `HTTP ${error.status}${error.razorpayCode ? ` ${error.razorpayCode}` : ""}`;
  if (error instanceof Error) return error.name === "TimeoutError" ? "timeout" : error.message.slice(0, 120);
  return "unknown";
}
