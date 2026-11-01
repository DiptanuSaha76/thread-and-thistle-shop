import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * "Track Order" for a signed-in customer's own order. The order's ownership is
 * checked on the server before any tracking information is returned.
 */
export const getOrderTracking = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(z.object({ orderId: z.string().uuid() }))
  .handler(async ({ data, context }) => {
    const { getOrderTracking: track, TrackingError } = await import("./tracking.server");
    const { shiprocketClient } = await import("./shiprocket.server");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    try {
      return await track(
        { userDb: context.supabase, adminDb: supabaseAdmin, tracker: shiprocketClient() },
        context.userId,
        data.orderId,
      );
    } catch (error) {
      if (error instanceof TrackingError) throw new Error(error.message);
      console.error(
        "[tracking] Unexpected error:",
        error instanceof Error ? error.message : "unknown",
      );
      throw new Error("We couldn't load tracking right now. Please try again.");
    }
  });
