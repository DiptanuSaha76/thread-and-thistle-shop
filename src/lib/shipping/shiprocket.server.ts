/**
 * Shiprocket API client - TRACKING ONLY. SERVER ONLY.
 *
 * Uses two documented read-only calls (https://apidocs.shiprocket.in/):
 *   POST /v1/external/auth/login                  -> { token }  (API user, Settings -> API)
 *   GET  /v1/external/courier/track/awb/{awb}     -> tracking for one AWB
 * Nothing here creates orders or shipments, assigns couriers, books pickups or
 * generates labels, so no billable shipping action can be triggered.
 *
 * Real API calls are made only when SHIPROCKET_TRACKING_ENABLED=true (set it once
 * the client has confirmed their Shiprocket plan allows API access). Credentials
 * and tokens are never logged.
 */

import { isTrackableAwb } from "./awb";

export const SHIPROCKET_DEFAULT_BASE_URL = "https://apiv2.shiprocket.in";
const TIMEOUT_MS = 10_000;
/** Shiprocket documents a 240-hour token; refresh a day early. */
const TOKEN_TTL_MS = 9 * 24 * 60 * 60 * 1000;

export type ShiprocketConfig = { email: string; password: string; baseUrl: string };

export function shiprocketConfig(
  env: Record<string, string | undefined> = process.env,
): ShiprocketConfig | null {
  if (env["SHIPROCKET_TRACKING_ENABLED"]?.trim().toLowerCase() !== "true") return null;
  const email = env["SHIPROCKET_API_EMAIL"]?.trim();
  const password = env["SHIPROCKET_API_PASSWORD"];
  if (!email || !password) {
    console.error("[shiprocket] Tracking is enabled but the API user email/password are missing.");
    return null;
  }
  const baseUrl = (env["SHIPROCKET_API_BASE_URL"]?.trim() || SHIPROCKET_DEFAULT_BASE_URL).replace(
    /\/+$/,
    "",
  );
  if (!isAllowedBaseUrl(baseUrl)) {
    console.error(
      "[shiprocket] SHIPROCKET_API_BASE_URL must be an https URL; tracking is disabled.",
    );
    return null;
  }
  return { email, password, baseUrl };
}

function isAllowedBaseUrl(value: string) {
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

/** AWB numbers are letters/digits (some couriers use hyphens). */
/** Same rule the admin save uses (src/lib/shipping/awb.ts). */
export { isTrackableAwb };

export type TrackingEvent = { time: string; activity: string; location: string };
export type TrackingSnapshot = {
  /** "ok": scan activity found; "no_activity": no scans reported yet; "not_found": Shiprocket answered 404. */
  result: "ok" | "no_activity" | "not_found";
  currentStatus: string | null;
  estimatedDelivery: string | null;
  trackUrl: string | null;
  events: TrackingEvent[];
};

export class ShiprocketError extends Error {
  constructor(readonly kind: "auth" | "rate_limited" | "unavailable" | "bad_response") {
    super(`Shiprocket ${kind}`);
    this.name = "ShiprocketError";
  }
}

const text = (value: unknown, max: number) => {
  if (typeof value !== "string" && typeof value !== "number") return "";
  return [...String(value)]
    .map((ch) =>
      ch.charCodeAt(0) < 32 || ch.charCodeAt(0) === 127 || ch === "<" || ch === ">" ? " " : ch,
    )
    .join("")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
};

/** Only Shiprocket's own tracking pages are linked. */
function safeTrackUrl(value: unknown) {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value.replace(/^http:/, "https:"));
    url.pathname = url.pathname.replace(/\/{2,}/g, "/");
    const host = url.hostname.toLowerCase();
    const trusted = ["shiprocket.co", "shiprocket.in"].some(
      (d) => host === d || host.endsWith(`.${d}`),
    );
    return url.protocol === "https:" && trusted && url.href.length <= 500 ? url.href : null;
  } catch {
    return null;
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);

/**
 * Reads Shiprocket's tracking response defensively. Accepts both shapes seen in
 * the wild: { tracking_data: {...} } and { "<awb>": { tracking_data: {...} } }.
 * Only status text, expected delivery, Shiprocket's tracking link and scan
 * events (time, activity, location) are kept; names, addresses, phone numbers
 * and anything else in the response are dropped.
 */
export function parseTrackingResponse(body: unknown, awb: string): TrackingSnapshot {
  if (!isRecord(body)) throw new ShiprocketError("bad_response");
  const wrapped = isRecord(body[awb]) ? (body[awb] as Record<string, unknown>) : body;
  const data = wrapped["tracking_data"];
  if (!isRecord(data)) throw new ShiprocketError("bad_response");

  const tracks = Array.isArray(data["shipment_track"])
    ? data["shipment_track"].filter(isRecord)
    : [];
  const activities = Array.isArray(data["shipment_track_activities"])
    ? data["shipment_track_activities"].filter(isRecord)
    : [];
  const events = activities
    .map((a) => ({
      time: text(a["date"], 40),
      activity: text(a["activity"] ?? a["sr-status-label"] ?? a["status"], 160),
      location: text(a["location"], 80),
    }))
    .filter((e) => e.activity)
    .sort(
      (a, b) =>
        (Date.parse(b.time.replace(" ", "T")) || 0) - (Date.parse(a.time.replace(" ", "T")) || 0),
    )
    .slice(0, 50);
  const currentStatus = text(tracks[0]?.["current_status"], 120) || events[0]?.activity || null;
  const estimatedDelivery = text(data["etd"] ?? tracks[0]?.["edd"], 40) || null;
  const trackUrl = safeTrackUrl(data["track_url"]);
  // No scans yet (Shiprocket answers with an "error" text such as "no activities found").
  // Its wording is not interpreted beyond that.
  const result: TrackingSnapshot["result"] = events.length ? "ok" : "no_activity";
  return { result, currentStatus, estimatedDelivery, trackUrl, events };
}

type TokenCache = { token: string; expiresAt: number } | null;

export function createShiprocketClient(config: ShiprocketConfig, fetchImpl: typeof fetch = fetch) {
  let cached: TokenCache = null;

  async function call(path: string, init: RequestInit) {
    try {
      return await fetchImpl(`${config.baseUrl}${path}`, {
        ...init,
        signal: AbortSignal.timeout(TIMEOUT_MS),
        redirect: "error",
      });
    } catch {
      console.error(
        `[shiprocket] Request failed (network/timeout): ${path.split("/").slice(0, 5).join("/")}`,
      );
      throw new ShiprocketError("unavailable");
    }
  }

  async function login(): Promise<string> {
    const response = await call("/v1/external/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ email: config.email, password: config.password }),
    });
    if (response.status === 429) throw new ShiprocketError("rate_limited");
    if (response.status === 400 || response.status === 401 || response.status === 403) {
      console.error(
        `[shiprocket] Login refused (HTTP ${response.status}). Check the API user credentials.`,
      );
      throw new ShiprocketError("auth");
    }
    if (!response.ok) {
      console.error(`[shiprocket] Login failed (HTTP ${response.status}).`);
      throw new ShiprocketError("unavailable");
    }
    const body = (await response.json().catch(() => null)) as { token?: unknown } | null;
    if (typeof body?.token !== "string" || body.token.length < 10)
      throw new ShiprocketError("bad_response");
    cached = { token: body.token, expiresAt: Date.now() + TOKEN_TTL_MS };
    return body.token;
  }

  async function token(forceNew = false) {
    if (!forceNew && cached && cached.expiresAt > Date.now()) return cached.token;
    cached = null;
    return login();
  }

  /** Tracking for one AWB. Retries once with a fresh token if Shiprocket says the token is invalid. */
  async function trackAwb(awb: string): Promise<TrackingSnapshot> {
    if (!isTrackableAwb(awb))
      return {
        result: "not_found",
        currentStatus: null,
        estimatedDelivery: null,
        trackUrl: null,
        events: [],
      };
    const clean = awb.trim();
    for (const forceNew of [false, true]) {
      const response = await call(`/v1/external/courier/track/awb/${encodeURIComponent(clean)}`, {
        method: "GET",
        headers: { accept: "application/json", authorization: `Bearer ${await token(forceNew)}` },
      });
      if (response.status === 401 && !forceNew) continue;
      if (response.status === 429) throw new ShiprocketError("rate_limited");
      if (response.status === 404)
        return {
          result: "not_found",
          currentStatus: null,
          estimatedDelivery: null,
          trackUrl: null,
          events: [],
        };
      if (response.status === 401 || response.status === 403) throw new ShiprocketError("auth");
      if (!response.ok) {
        console.error(`[shiprocket] Tracking request failed (HTTP ${response.status}).`);
        throw new ShiprocketError("unavailable");
      }
      const body = await response.json().catch(() => null);
      return parseTrackingResponse(body, clean);
    }
    throw new ShiprocketError("auth");
  }

  return { trackAwb };
}

let shared: { key: string; client: ReturnType<typeof createShiprocketClient> } | null = null;

/** One client per server instance so the login token is reused between requests. */
export function shiprocketClient() {
  const config = shiprocketConfig();
  if (!config) return null;
  const key = `${config.baseUrl}|${config.email}`;
  if (!shared || shared.key !== key) shared = { key, client: createShiprocketClient(config) };
  return shared.client;
}
