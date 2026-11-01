import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

/**
 * Browser-callable sign-up pre-check (no session needed; it creates nothing and sends nothing).
 * The server-only module is imported inside the handler so it never reaches the browser bundle.
 */
export const checkSignupDetails = createServerFn({ method: "POST" })
  .validator(
    z.object({
      first: z.string().max(200),
      last: z.string().max(200),
      email: z.string().max(320),
      country: z.string().max(4),
      mobile: z.string().max(40),
    }),
  )
  .handler(async ({ data }) => {
    const { signupCheckService, SIGNUP_CHECK_FAILED } = await import("./signup.server");
    try {
      return await (await signupCheckService()).check(data);
    } catch (error) {
      console.error(
        "[signup] Unexpected error:",
        error instanceof Error ? error.message : "unknown",
      );
      return { ok: false as const, message: SIGNUP_CHECK_FAILED };
    }
  });
