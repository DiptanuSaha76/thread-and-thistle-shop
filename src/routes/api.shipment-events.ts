import { timingSafeEqual } from "node:crypto";
import { Buffer } from "node:buffer";
import { createFileRoute } from "@tanstack/react-router";

function matchesToken(expected: string, supplied: string): boolean {
  const left = Buffer.from(expected);
  const right = Buffer.from(supplied);
  return left.length === right.length && timingSafeEqual(left, right);
}

export const Route = createFileRoute("/api/shipment-events")({
  server: {
    handlers: {
      GET: async () => Response.json({ ok: true, service: "YEARTH shipment event receiver" }),
      POST: async ({ request }) => {
        const expected = process.env["SHIPROCKET_WEBHOOK_TOKEN"]?.trim();
        const supplied = request.headers.get("x-api-key")?.trim() ?? "";
        if (!expected) return Response.json({ ok: false, message: "Webhook token is not configured." }, { status: 503 });
        if (!supplied || !matchesToken(expected, supplied)) return Response.json({ ok: false }, { status: 401 });
        try {
          const payload: unknown = await request.json();
          const { applyShiprocketWebhook } = await import("@/lib/shipping/webhook.server");
          const result = await applyShiprocketWebhook(payload);
          return Response.json({ ok: true, ...result }, { status: 200 });
        } catch (error) {
          console.error("[shipping-webhook] Event processing failed:", error instanceof Error ? error.message : "unknown error");
          return Response.json({ ok: false, message: "Event could not be processed." }, { status: 500 });
        }
      },
    },
  },
});
