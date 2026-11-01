import { createFileRoute } from "@tanstack/react-router";

const MAX_BODY_BYTES = 256 * 1024;

/**
 * Razorpay webhook (Dashboard -> Webhooks -> https://<your-domain>/api/razorpay/webhook).
 * Events used: payment.captured, order.paid, payment.failed. Every request must
 * carry a valid X-Razorpay-Signature made with RAZORPAY_WEBHOOK_SECRET.
 */
export const Route = createFileRoute("/api/razorpay/webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const length = Number(request.headers.get("content-length") ?? "0");
        if (length > MAX_BODY_BYTES) return new Response("Payload too large", { status: 413 });
        const rawBody = await request.text();
        if (rawBody.length > MAX_BODY_BYTES)
          return new Response("Payload too large", { status: 413 });
        const { handleRazorpayWebhook } = await import("@/lib/payments/payments.server");
        const result = await handleRazorpayWebhook(
          rawBody,
          request.headers.get("x-razorpay-signature"),
        );
        return new Response(result.body, {
          status: result.status,
          headers: { "content-type": "text/plain" },
        });
      },
    },
  },
});
