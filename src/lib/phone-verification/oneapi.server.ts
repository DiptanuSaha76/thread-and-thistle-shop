/**
 * OneAPI SMS client. SERVER ONLY - never import this from browser code.
 *
 * Only the documented "send OTP" call is used:
 *   POST https://backend.oneapi.in/sms/sendotp   (JSON)
 *   { apiKey, brandName, customerName, number, otp } -> { success, msg }
 * OneAPI only delivers the code we generate; it does not verify codes, so the
 * website generates, stores (hashed) and checks codes itself.
 *
 * The API key, the full phone number and the code are never logged.
 */

export const ONEAPI_DEFAULT_ENDPOINT = "https://backend.oneapi.in/sms/sendotp";
const TIMEOUT_MS = 10_000;

export type OneApiConfig = {
  apiKey: string;
  brandName: string;
  endpoint: string;
};

/** Reads the server environment. Returns null (feature off) when anything required is missing. */
export function oneApiConfig(
  env: Record<string, string | undefined> = process.env,
): OneApiConfig | null {
  const apiKey = env["ONEAPI_SMS_API_KEY"]?.trim();
  const brandName = env["ONEAPI_SMS_BRAND_NAME"]?.trim();
  if (!apiKey || !brandName) return null;
  const endpoint = env["ONEAPI_SMS_ENDPOINT"]?.trim() || ONEAPI_DEFAULT_ENDPOINT;
  if (!isAllowedEndpoint(endpoint)) {
    console.error("[sms] ONEAPI_SMS_ENDPOINT must be an https URL; SMS sending is disabled.");
    return null;
  }
  return { apiKey, brandName: brandName.slice(0, 40), endpoint };
}

/** https only; plain http is accepted for a local test server (localhost) alone. */
function isAllowedEndpoint(value: string) {
  try {
    const url = new URL(value);
    if (url.protocol === "https:") return true;
    return (
      url.protocol === "http:" && (url.hostname === "127.0.0.1" || url.hostname === "localhost")
    );
  } catch {
    return false;
  }
}

/** Letters, spaces, dots, hyphens and apostrophes only, at most 30 characters (SMS template variable). */
export function smsCustomerName(value: string | null | undefined) {
  const cleaned = (value ?? "")
    .normalize("NFC")
    .replace(/[^\p{L}\p{M} .'-]/gu, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 30)
    .trim();
  return cleaned || "Customer";
}

export type SmsSendResult =
  | { ok: true }
  | {
      ok: false;
      reason: "network" | "timeout" | "http" | "bad_response" | "rejected";
      status?: number;
    };

/**
 * Sends one OTP SMS. `nationalNumber` is the 10-digit Indian mobile number
 * (no +91), sent as a JSON number like the provider's documented example.
 * Success is reported only when the provider answers 2xx with `success: true`.
 */
export async function sendOneApiOtp(
  config: OneApiConfig,
  message: { nationalNumber: string; otp: string; customerName: string },
  fetchImpl: typeof fetch = fetch,
): Promise<SmsSendResult> {
  if (!/^[6-9]\d{9}$/.test(message.nationalNumber) || !/^[1-9]\d{5}$/.test(message.otp)) {
    return { ok: false, reason: "rejected" };
  }
  let response: Response;
  try {
    response = await fetchImpl(config.endpoint, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({
        apiKey: config.apiKey,
        brandName: config.brandName,
        customerName: message.customerName,
        number: Number(message.nationalNumber),
        otp: Number(message.otp),
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
      redirect: "error",
    });
  } catch (error) {
    const timedOut =
      error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
    console.error(`[sms] OneAPI request failed (${timedOut ? "timeout" : "network"}).`);
    return { ok: false, reason: timedOut ? "timeout" : "network" };
  }
  if (!response.ok) {
    console.error(`[sms] OneAPI answered HTTP ${response.status}.`);
    return { ok: false, reason: "http", status: response.status };
  }
  let body: unknown;
  try {
    const text = await response.text();
    if (text.length > 10_000) throw new Error("too long");
    body = JSON.parse(text);
  } catch {
    console.error("[sms] OneAPI answered with a response that is not valid JSON.");
    return { ok: false, reason: "bad_response", status: response.status };
  }
  if (!body || typeof body !== "object" || (body as { success?: unknown }).success !== true) {
    // The provider's message may echo request details, so only a short, cleaned excerpt is logged.
    const msg = String((body as { msg?: unknown } | null)?.msg ?? "")
      .split(config.apiKey)
      .join("***")
      .replace(/\d{4,}/g, "#")
      .slice(0, 80);
    console.error(`[sms] OneAPI did not accept the message${msg ? `: ${msg}` : ""}.`);
    return { ok: false, reason: "rejected", status: response.status };
  }
  return { ok: true };
}
