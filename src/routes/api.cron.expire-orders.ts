import { createFileRoute } from "@tanstack/react-router";
import { authenticateCronRequest } from "@/integrations/supabase/cron-auth";

/**
 * Releases stock held by online orders that were never paid (older than 45
 * minutes). Call every 15-30 minutes from a scheduler with the header
 *   Authorization: Bearer <CRON_SECRET>
 */
export const Route = createFileRoute("/api/cron/expire-orders")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const denied = await authenticateCronRequest(request);
        if (denied) return denied;
        const { expireUnpaidOrders } = await import("@/lib/payments/payments.server");
        const result = await expireUnpaidOrders();
        return Response.json({ expired: result.expired }, { status: result.status });
      },
    },
  },
});
