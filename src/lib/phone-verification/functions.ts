import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Browser-callable mobile verification endpoints. Each one requires a signed-in
 * customer and works only on that customer's own profile number. The server-only
 * modules (SMS key, hashing secret, service-role client) are imported inside the
 * handlers so they never reach the browser bundle.
 */

const showSafe = async <T>(work: () => Promise<T>): Promise<T> => {
  const { PhoneVerificationError } = await import("./phone-verification.server");
  try {
    return await work();
  } catch (error) {
    if (error instanceof PhoneVerificationError) throw new Error(error.message);
    console.error("[sms] Unexpected error:", error instanceof Error ? error.message : "unknown");
    throw new Error("Something went wrong with mobile verification. Please try again.");
  }
};

export const getPhoneVerificationStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) =>
    showSafe(async () => {
      const { phoneVerificationService } = await import("./phone-verification.server");
      return (await phoneVerificationService()).getStatus(context.userId);
    }),
  );

export const sendPhoneVerificationCode = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) =>
    showSafe(async () => {
      const { getRequest } = await import("@tanstack/react-start/server");
      const { phoneVerificationService, clientIp } = await import("./phone-verification.server");
      return (await phoneVerificationService()).sendCode(
        context.userId,
        clientIp(getRequest()?.headers),
      );
    }),
  );

export const confirmPhoneVerificationCode = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(z.object({ code: z.string().regex(/^\d{6}$/) }))
  .handler(async ({ data, context }) =>
    showSafe(async () => {
      const { phoneVerificationService } = await import("./phone-verification.server");
      return (await phoneVerificationService()).verifyCode(context.userId, data.code);
    }),
  );
