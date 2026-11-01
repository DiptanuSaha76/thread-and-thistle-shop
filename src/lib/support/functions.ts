import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const SUPPORT_TOPICS = ["Product & sizing", "My order", "Returns & exchanges", "Something else"] as const;

/** Contact form. Open to everyone; validated, rate-limited and saved on the server. */
export const submitContactMessage = createServerFn({ method: "POST" })
  .validator(
    z.object({
      name: z.string().max(200),
      email: z.string().max(300),
      topic: z.enum(SUPPORT_TOPICS),
      message: z.string().max(5000),
    }),
  )
  .handler(async ({ data }) => {
    const { contactInput, submitContact, ContactError } = await import("./support.server");
    const { getRequest } = await import("@tanstack/react-start/server");
    const parsed = contactInput.safeParse(data);
    if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? "Please check your message.");
    try {
      await submitContact(parsed.data, getRequest()?.headers);
      return { ok: true as const };
    } catch (error) {
      if (error instanceof ContactError) throw new Error(error.message);
      console.error("[support] Unexpected error:", error instanceof Error ? error.message : "unknown");
      throw new Error("We couldn't send your message right now. Please try again later.");
    }
  });
