import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Browser-callable payment endpoints. The server-only modules are imported
 * inside the handlers so their code (and secrets) never reach the browser bundle.
 */

/** Which payment methods can be offered right now. */
export const getPaymentOptions = createServerFn({ method: "POST" }).handler(async () => {
  const { getPaymentOptionsData } = await import("./payments.server");
  return getPaymentOptionsData();
});

const showSafe = async <T>(work: () => Promise<T>): Promise<T> => {
  const { PaymentError } = await import("./payments.server");
  try {
    return await work();
  } catch (error) {
    if (error instanceof PaymentError) throw new Error(error.message);
    console.error("[payments] Unexpected error:", error instanceof Error ? error.message : error);
    throw new Error(
      "Something went wrong with the payment. Please check My Orders before trying again.",
    );
  }
};

export const startOnlinePayment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(z.object({ orderId: z.string().uuid() }))
  .handler(async ({ data, context }) =>
    showSafe(async () => {
      const { startPayment } = await import("./payments.server");
      return startPayment(context.supabase, context.userId, data.orderId);
    }),
  );

export const confirmOnlinePayment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(
    z.object({
      orderId: z.string().uuid(),
      razorpayOrderId: z.string().regex(/^order_[A-Za-z0-9]+$/),
      razorpayPaymentId: z.string().regex(/^pay_[A-Za-z0-9]+$/),
      razorpaySignature: z.string().regex(/^[a-f0-9]{64}$/),
    }),
  )
  .handler(async ({ data, context }) =>
    showSafe(async () => {
      const { confirmPayment } = await import("./payments.server");
      return confirmPayment(context.supabase, context.userId, data);
    }),
  );
