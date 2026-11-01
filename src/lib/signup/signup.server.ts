/**
 * Checks a sign-up before the account is created. SERVER ONLY.
 *
 * Sign-up is verified by SMS: Supabase creates the email/password account and signs the customer
 * in straight away, then the customer confirms the mobile number with a code sent through OneAPI
 * (src/lib/phone-verification). That only works when, in the Supabase project:
 *   Authentication -> Sign In / Providers -> Email -> "Confirm email" is switched OFF
 * (otherwise Supabase emails a confirmation link and does not sign the customer in).
 * This check refuses the sign-up, before any account exists or any email is sent, when that
 * setting is on or when SMS sending is not configured. It never falls back to email confirmation.
 *
 * The same rules are enforced again by Supabase and the database sign-up hook
 * (public.hook_before_user_created), so skipping this check from the browser gains nothing.
 */
import { emailProblem, nameProblem, signupHookMessages } from "@/lib/auth";
import { normalizePhone } from "@/lib/phone";
import {
  SMS_COUNTRIES,
  SMS_COUNTRY_MESSAGE,
  phoneVerificationConfig,
} from "@/lib/phone-verification/phone-verification.server";

export type SignupInput = {
  first: string;
  last: string;
  email: string;
  country: string;
  mobile: string;
};

export type SignupField = "first" | "last" | "mobile" | "email";

export type SignupCheck =
  { ok: true; phone: string } | { ok: false; field?: SignupField; message: string };

/** Shown when the store itself is not set up for SMS sign-up (the details are in the server log). */
export const SIGNUP_UNAVAILABLE =
  "New accounts can't be created right now because mobile verification isn't set up yet. Please try again later.";
export const SIGNUP_CHECK_FAILED =
  "We couldn't start your sign-up right now. Please try again in a few minutes.";

export type SignupDeps = {
  /** OneAPI key, brand name and PHONE_OTP_SECRET are configured on the server. */
  smsReady: () => boolean;
  /** public.check_signup_email(); null when the check itself failed. */
  emailVerdict: (email: string) => Promise<"ok" | "invalid" | "disposable" | null>;
  /** Supabase signs new email accounts in immediately ("Confirm email" off); null when unknown. */
  signsInImmediately: () => Promise<boolean | null>;
};

export async function checkSignup(input: SignupInput, deps: SignupDeps): Promise<SignupCheck> {
  const firstProblem = nameProblem(input.first, "First name");
  if (firstProblem) return { ok: false, field: "first", message: firstProblem };
  const lastProblem = nameProblem(input.last, "Last name");
  if (lastProblem) return { ok: false, field: "last", message: lastProblem };
  if (!input.mobile.trim())
    return { ok: false, field: "mobile", message: "Mobile number is required" };
  const phone = normalizePhone(input.country, input.mobile);
  if (!phone)
    return {
      ok: false,
      field: "mobile",
      message: "Enter a valid mobile number for the selected country",
    };
  if (!(SMS_COUNTRIES as readonly string[]).includes(input.country))
    return { ok: false, field: "mobile", message: SMS_COUNTRY_MESSAGE };
  const emailIssue = emailProblem(input.email);
  if (emailIssue) return { ok: false, field: "email", message: emailIssue };

  const verdict = await deps.emailVerdict(input.email.trim());
  if (verdict === "disposable")
    return { ok: false, field: "email", message: signupHookMessages[0].message };
  if (verdict === "invalid")
    return { ok: false, field: "email", message: "Enter a valid email address" };
  // null: the early check failed; the database sign-up hook still enforces the rule.

  if (!deps.smsReady()) {
    console.error(
      "[signup] Refused: SMS verification is not configured (ONEAPI_SMS_API_KEY, ONEAPI_SMS_BRAND_NAME and PHONE_OTP_SECRET are required on the server).",
    );
    return { ok: false, message: SIGNUP_UNAVAILABLE };
  }
  const immediate = await deps.signsInImmediately();
  if (immediate === null) return { ok: false, message: SIGNUP_CHECK_FAILED };
  if (!immediate) {
    console.error(
      '[signup] Refused: Supabase Auth "Confirm email" is switched on, so new accounts would get an email link instead of SMS verification. Switch it off in Authentication -> Sign In / Providers -> Email.',
    );
    return { ok: false, message: SIGNUP_UNAVAILABLE };
  }
  return { ok: true, phone };
}

/**
 * Reads Supabase Auth's public settings (GET /auth/v1/settings). `mailer_autoconfirm: true`
 * means "Confirm email" is off: a new email account is signed in straight away.
 */
export async function readSignsInImmediately(
  env: Record<string, string | undefined> = process.env,
  fetchImpl: typeof fetch = fetch,
): Promise<boolean | null> {
  const base = (env["SUPABASE_URL"] ?? "").trim().replace(/\/+$/, "");
  const key = (env["SUPABASE_PUBLISHABLE_KEY"] ?? "").trim();
  if (!base || !key) {
    console.error("[signup] SUPABASE_URL or SUPABASE_PUBLISHABLE_KEY is missing on the server.");
    return null;
  }
  try {
    const response = await fetchImpl(`${base}/auth/v1/settings`, {
      headers: { apikey: key, accept: "application/json" },
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) {
      console.error(`[signup] Supabase Auth settings answered HTTP ${response.status}.`);
      return null;
    }
    const body = (await response.json()) as { mailer_autoconfirm?: unknown } | null;
    return typeof body?.mailer_autoconfirm === "boolean" ? body.mailer_autoconfirm : null;
  } catch {
    console.error("[signup] Could not read Supabase Auth settings.");
    return null;
  }
}

/** The check used by the server function: real configuration, service-role email check. */
export async function signupCheckService() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const deps: SignupDeps = {
    smsReady: () => !!phoneVerificationConfig(),
    emailVerdict: async (email) => {
      const { data, error } = await supabaseAdmin.rpc("check_signup_email", { p_email: email });
      if (error) {
        console.error("[signup] Email check failed:", error.message);
        return null;
      }
      return data === "ok" || data === "invalid" || data === "disposable" ? data : null;
    },
    signsInImmediately: () => readSignsInImmediately(),
  };
  return { check: (input: SignupInput) => checkSignup(input, deps) };
}
