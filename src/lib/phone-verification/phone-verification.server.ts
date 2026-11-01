/**
 * Mobile number verification by SMS code. SERVER ONLY.
 *
 * - The number verified is always the one saved on the signed-in customer's
 *   profile (read here with the service role); the browser never chooses it,
 *   so nobody can verify, or send SMS to, someone else's number.
 * - Codes come from crypto.randomInt and are stored only as an HMAC-SHA256 made
 *   with PHONE_OTP_SECRET. Expiry, attempt limits, the resend cooldown and the
 *   per-account / per-number / per-IP limits are enforced atomically by the
 *   database functions in supabase/migrations/20261028090600_phone_verification.sql.
 * - Only OneAPI's documented "send" call is used; it cannot verify codes.
 */
import { createHmac, randomInt, randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { callingCountries } from "@/lib/phone";
import { oneApiConfig, sendOneApiOtp, smsCustomerName, type OneApiConfig } from "./oneapi.server";
import { SMS_COUNTRY_MESSAGE, type SendOutcome, type VerifyOutcome } from "./messages";

type Db = SupabaseClient<Database>;

/** Errors whose message is safe to show the customer. */
export class PhoneVerificationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PhoneVerificationError";
  }
}

/** Countries OneAPI is known to deliver to (its documented example is a 10-digit Indian number). */
export const SMS_COUNTRIES = ["IN"] as const;

export const CODE_TTL_SECONDS = 600; // keep in sync with the migration
export const RESEND_SECONDS = 60;

const UNAVAILABLE = "Mobile verification isn't available right now. Please try again later.";
const LOAD_FAILED = "We couldn't load your mobile number. Please try again.";
const SEND_FAILED = "We couldn't send the code right now. Please try again in a minute.";
const NO_PHONE = "Add your mobile number to your profile first.";
/** Shown when the number's country is not in SMS_COUNTRIES (also used by the sign-up check). */
export { SMS_COUNTRY_MESSAGE };
const UNSUPPORTED = SMS_COUNTRY_MESSAGE;
const PHONE_IN_USE =
  "This mobile number can't be used for this account. Please use a different number, or log in to the account that already uses it.";

export type PhoneVerificationConfig = { sms: OneApiConfig; secret: string };

let reportedMissing = false;

export function phoneVerificationConfig(
  env: Record<string, string | undefined> = process.env,
): PhoneVerificationConfig | null {
  const sms = oneApiConfig(env);
  if (!sms) {
    if (!reportedMissing) {
      reportedMissing = true;
      const missing = ["ONEAPI_SMS_API_KEY", "ONEAPI_SMS_BRAND_NAME"].filter(
        (name) => !env[name]?.trim(),
      );
      console.error(
        `[sms] Mobile verification is disabled: ${missing.length ? `${missing.join(" and ")} not set` : "the OneAPI settings are invalid"} on the server.`,
      );
    }
    return null;
  }
  const secret = env["PHONE_OTP_SECRET"] ?? "";
  if (secret.length < 32) {
    console.error(
      "[sms] PHONE_OTP_SECRET is missing or shorter than 32 characters; mobile verification is disabled.",
    );
    return null;
  }
  return { sms, secret };
}

const hmac = (secret: string, value: string) =>
  createHmac("sha256", secret).update(value, "utf8").digest("hex");
export const otpHash = (secret: string, userId: string, phone: string, code: string) =>
  hmac(secret, `phone-otp:v1|${userId}|${phone}|${code}`);
export const ipHash = (secret: string, ip: string | null) =>
  ip ? hmac(secret, `ip:v1|${ip}`) : null;

/** "+91 ••••••3210" */
export function maskPhone(phone: string) {
  const dial = callingCountries
    .map((c) => c.dial as string)
    .filter((d) => phone.startsWith(d))
    .sort((a, b) => b.length - a.length)[0];
  if (!dial) return "••••";
  const national = phone.slice(dial.length);
  return `${dial} ${"•".repeat(Math.max(0, national.length - 4))}${national.slice(-4)}`;
}

/** The caller's IP address, from the hosting platform's headers. Used only as a hashed rate-limit key. */
export function clientIp(headers: Headers | null | undefined) {
  if (!headers) return null;
  const candidate =
    headers.get("cf-connecting-ip") ??
    headers.get("x-real-ip") ??
    headers.get("x-forwarded-for")?.split(",")[0] ??
    null;
  const ip = candidate?.trim() ?? "";
  return /^[0-9a-fA-F:.]{3,45}$/.test(ip) ? ip : null;
}

export type PhoneVerificationStatus = {
  /** SMS verification is configured on the server. */
  enabled: boolean;
  hasPhone: boolean;
  /** The provider can send to this number's country. */
  supported: boolean;
  verified: boolean;
  phoneMasked: string | null;
  resendIn: number;
  codeActive: boolean;
};

export type SendCodeResult = SendOutcome;
export type VerifyCodeResult = VerifyOutcome;

type Deps = {
  db: Db;
  config: PhoneVerificationConfig | null;
  fetchImpl?: typeof fetch;
  generateCode?: () => string;
};

type ProfileRow = {
  phone: string;
  phone_country: string;
  phone_verified_at: string | null;
  first_name: string;
};

/** The profile's SMS fields. Columns may be NULL on the live table; they are read as "". */
async function loadProfile(db: Db, userId: string): Promise<ProfileRow | null> {
  const { data, error } = await db
    .from("profiles")
    .select("phone, phone_country, phone_verified_at, first_name")
    .eq("id", userId)
    .maybeSingle();
  if (error) {
    console.error("[sms] Could not read the profile:", error.message);
    throw new PhoneVerificationError(LOAD_FAILED);
  }
  if (!data) return null;
  const row = data as Record<string, unknown>;
  const text = (value: unknown) => (typeof value === "string" ? value.trim() : "");
  return {
    phone: text(row["phone"]),
    phone_country: text(row["phone_country"]),
    phone_verified_at: text(row["phone_verified_at"]) || null,
    first_name: text(row["first_name"]),
  };
}

/** One verified mobile number per account: true when another account already verified it. */
async function verifiedElsewhere(db: Db, userId: string, phone: string) {
  const { data, error } = await db
    .from("profiles")
    .select("id")
    .eq("phone", phone)
    .not("phone_verified_at", "is", null)
    .neq("id", userId)
    .limit(1);
  if (error) {
    console.error("[sms] Could not check the number:", error.message);
    throw new PhoneVerificationError(LOAD_FAILED);
  }
  return (data ?? []).length > 0;
}

const isSupported = (country: string) => (SMS_COUNTRIES as readonly string[]).includes(country);
const asRecord = (value: unknown) =>
  value && typeof value === "object" ? (value as Record<string, unknown>) : {};
const asSeconds = (value: unknown, fallback: number) =>
  typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.ceil(value) : fallback;

export function createPhoneVerification({ db, config, fetchImpl, generateCode }: Deps) {
  const newCode = generateCode ?? (() => String(randomInt(100000, 1000000))); // 6 digits, no leading zero

  async function getStatus(userId: string): Promise<PhoneVerificationStatus> {
    const profile = await loadProfile(db, userId);
    const phone = profile?.phone ?? "";
    const base: PhoneVerificationStatus = {
      enabled: !!config,
      hasPhone: !!phone,
      supported: !!phone && isSupported(profile?.phone_country ?? ""),
      verified: !!profile?.phone_verified_at,
      phoneMasked: phone ? maskPhone(phone) : null,
      resendIn: 0,
      codeActive: false,
    };
    if (!config || !phone || base.verified) return base;
    const { data, error } = await db.rpc("phone_otp_status", { p_user: userId });
    if (error) {
      console.error("[sms] Could not read verification status:", error.message);
      return base;
    }
    const row = asRecord(data);
    return {
      ...base,
      resendIn: asSeconds(row["resend_in"], 0),
      codeActive: row["code_active"] === true,
    };
  }

  async function sendCode(userId: string, ip: string | null): Promise<SendCodeResult> {
    if (!config) throw new PhoneVerificationError(UNAVAILABLE);
    const profile = await loadProfile(db, userId);
    if (!profile?.phone) throw new PhoneVerificationError(NO_PHONE);
    if (profile.phone_verified_at) return { status: "already_verified" };
    if (!isSupported(profile.phone_country)) throw new PhoneVerificationError(UNSUPPORTED);
    if (await verifiedElsewhere(db, userId, profile.phone))
      throw new PhoneVerificationError(PHONE_IN_USE);

    const code = newCode();
    const challengeId = randomUUID();
    const begin = await db.rpc("phone_otp_begin", {
      p_user: userId,
      p_challenge: challengeId,
      p_phone: profile.phone,
      p_otp_hash: otpHash(config.secret, userId, profile.phone, code),
      p_ip_hash: ipHash(config.secret, ip),
    });
    if (begin.error) {
      console.error("[sms] Could not start verification:", begin.error.message);
      throw new PhoneVerificationError(SEND_FAILED);
    }
    const started = asRecord(begin.data);
    if (started["ok"] !== true) {
      switch (started["reason"]) {
        case "COOLDOWN":
          return {
            status: "cooldown",
            resendIn: asSeconds(started["retry_after"], RESEND_SECONDS),
          };
        case "RATE_LIMITED":
          return { status: "rate_limited", retryAfter: asSeconds(started["retry_after"], 3600) };
        case "ALREADY_VERIFIED":
          return { status: "already_verified" };
        case "PHONE_CHANGED":
          throw new PhoneVerificationError(
            "Your mobile number was just changed. Please refresh the page and try again.",
          );
        case "NO_PHONE":
          throw new PhoneVerificationError(NO_PHONE);
        default:
          throw new PhoneVerificationError(
            "Please check your mobile number in your profile and try again.",
          );
      }
    }

    const sent = await sendOneApiOtp(
      config.sms,
      {
        nationalNumber: profile.phone.slice(3),
        otp: code,
        customerName: smsCustomerName(profile.first_name),
      },
      fetchImpl,
    );
    const mark = await db.rpc("phone_otp_mark_sent", { p_challenge: challengeId, p_sent: sent.ok });
    if (mark.error) {
      console.error("[sms] Could not record the send result:", mark.error.message);
      if (sent.ok) throw new PhoneVerificationError(SEND_FAILED);
    }
    if (!sent.ok) throw new PhoneVerificationError(SEND_FAILED);
    return {
      status: "sent",
      resendIn: asSeconds(started["resend_in"], RESEND_SECONDS),
      expiresIn: asSeconds(started["expires_in"], CODE_TTL_SECONDS),
      phoneMasked: maskPhone(profile.phone),
    };
  }

  async function verifyCode(userId: string, code: string): Promise<VerifyCodeResult> {
    if (!/^\d{6}$/.test(code))
      throw new PhoneVerificationError("Enter the 6-digit code from the SMS.");
    if (!config) throw new PhoneVerificationError(UNAVAILABLE);
    const profile = await loadProfile(db, userId);
    if (!profile?.phone) throw new PhoneVerificationError(NO_PHONE);
    if (profile.phone_verified_at) return { status: "verified" };
    if (await verifiedElsewhere(db, userId, profile.phone))
      throw new PhoneVerificationError(PHONE_IN_USE);
    const { data, error } = await db.rpc("phone_otp_verify", {
      p_user: userId,
      p_otp_hash: otpHash(config.secret, userId, profile.phone, code),
    });
    if (error) {
      console.error("[sms] Could not check the code:", error.message);
      throw new PhoneVerificationError("We couldn't check the code right now. Please try again.");
    }
    const result = asRecord(data);
    switch (result["reason"]) {
      case "VERIFIED":
      case "ALREADY_VERIFIED":
        return { status: "verified" };
      case "INCORRECT":
        return { status: "incorrect", attemptsLeft: asSeconds(result["attempts_left"], 0) };
      case "LOCKED":
        return { status: "locked" };
      case "EXPIRED":
        return { status: "expired" };
      default:
        return { status: "no_code" };
    }
  }

  return { getStatus, sendCode, verifyCode };
}

/** The service used by the server functions: service-role database client + environment config. */
export async function phoneVerificationService() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return createPhoneVerification({ db: supabaseAdmin, config: phoneVerificationConfig() });
}
