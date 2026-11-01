/**
 * Contact form submissions. SERVER ONLY.
 * Messages are saved to public.support_messages (the admin "Support" inbox) through
 * public.submit_support_message(), which validates them and applies the rate limits.
 * No email is sent: no email service is configured for the shop.
 */
import { createHmac } from "node:crypto";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { clientIp } from "@/lib/phone-verification/phone-verification.server";

export const SUPPORT_TOPICS = ["Product & sizing", "My order", "Returns & exchanges", "Something else"] as const;

export const contactInput = z.object({
  name: z.string().trim().min(1, "Please enter your name.").max(100, "Your name is too long."),
  email: z.string().trim().email("Please enter a valid email address.").max(255),
  topic: z.enum(SUPPORT_TOPICS),
  message: z
    .string()
    .trim()
    .min(10, "Please write a little more (at least 10 characters).")
    .max(4000, "Please keep your message under 4000 characters."),
});
export type ContactInput = z.infer<typeof contactInput>;

/** Errors whose message is safe to show the visitor. */
export class ContactError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ContactError";
  }
}

const dbMessages: Record<string, string> = {
  RATE_LIMITED: "You've sent several messages recently. Please wait a while before sending another.",
  INVALID_EMAIL: "Please enter a valid email address.",
  INVALID_NAME: "Please enter your name.",
  INVALID_TOPIC: "Please choose a topic.",
  INVALID_MESSAGE: "Please write a message between 10 and 4000 characters.",
};

/** IP addresses are never stored; only a keyed hash used for the rate limit. */
function ipHash(ip: string | null) {
  const key = process.env["SUPABASE_SERVICE_ROLE_KEY"];
  if (!ip || !key) return null;
  return createHmac("sha256", key).update(`support-ip:v1|${ip}`, "utf8").digest("hex");
}

/** The signed-in customer, if the request carries a valid session; otherwise null. */
async function optionalUserId(headers: Headers | undefined) {
  const token = headers?.get("authorization")?.match(/^Bearer (\S+)$/)?.[1];
  if (!token || token.split(".").length !== 3) return null;
  const { data, error } = await supabaseAdmin.auth.getUser(token);
  return error ? null : (data.user?.id ?? null);
}

export async function submitContact(input: ContactInput, headers: Headers | undefined) {
  const { data, error } = await supabaseAdmin.rpc("submit_support_message", {
    p_name: input.name,
    p_email: input.email,
    p_topic: input.topic,
    p_message: input.message,
    p_user: await optionalUserId(headers),
    p_ip_hash: ipHash(clientIp(headers)),
  });
  if (error) {
    const known = dbMessages[error.message];
    if (!known) console.error("[support] Could not save contact message:", error.message);
    throw new ContactError(known ?? "We couldn't send your message right now. Please try again later.");
  }
  return { id: String(data) };
}
