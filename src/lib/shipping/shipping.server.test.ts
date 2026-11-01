import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createShiprocketClient,
  isTrackableAwb,
  parseTrackingResponse,
  ShiprocketError,
  shiprocketConfig,
  type TrackingSnapshot,
} from "./shiprocket.server";
import {
  FRESH_MS,
  getOrderTracking,
  RETRY_AFTER_FAILURE_MS,
  TrackingError,
} from "./tracking.server";

// Shiprocket and the database are fakes here: no real API call, no shipment is created.
afterEach(() => vi.restoreAllMocks());
const AWB = "SR1234567890";
const sample = {
  tracking_data: {
    track_status: 1,
    shipment_status: 6,
    shipment_track: [
      {
        awb_code: AWB,
        current_status: "In Transit",
        consignee_name: "Asha Rao",
        destination: "Pune",
        edd: null,
      },
    ],
    shipment_track_activities: [
      {
        date: "2026-10-27 09:10:00",
        activity: "Shipment picked up",
        location: "Mumbai",
        "sr-status": "42",
      },
      {
        date: "2026-10-28 18:30:00",
        activity: "In transit <script>",
        location: "Pune Hub",
        "sr-status": "18",
      },
    ],
    track_url: "https://shiprocket.co//tracking/SR1234567890",
    etd: "2026-10-30 23:59:00",
  },
};

describe("configuration", () => {
  it("makes no API calls unless explicitly enabled", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(
      shiprocketConfig({ SHIPROCKET_API_EMAIL: "api@x.in", SHIPROCKET_API_PASSWORD: "p" }),
    ).toBeNull();
    expect(shiprocketConfig({ SHIPROCKET_TRACKING_ENABLED: "true" })).toBeNull();
    expect(
      shiprocketConfig({
        SHIPROCKET_TRACKING_ENABLED: "true",
        SHIPROCKET_API_EMAIL: "api@x.in",
        SHIPROCKET_API_PASSWORD: "p",
      }),
    ).toEqual({
      email: "api@x.in",
      password: "p",
      baseUrl: "https://apiv2.shiprocket.in",
    });
    expect(
      shiprocketConfig({
        SHIPROCKET_TRACKING_ENABLED: "true",
        SHIPROCKET_API_EMAIL: "a",
        SHIPROCKET_API_PASSWORD: "p",
        SHIPROCKET_API_BASE_URL: "http://evil.example",
      }),
    ).toBeNull();
  });
  it("accepts only AWB-shaped tracking numbers", () => {
    expect(isTrackableAwb(AWB)).toBe(true);
    expect(isTrackableAwb("12345")).toBe(false);
    expect(isTrackableAwb("../../orders/create")).toBe(false);
    expect(isTrackableAwb("AWB 123456")).toBe(false);
  });
});

describe("parseTrackingResponse", () => {
  it("keeps only status, expected delivery, the Shiprocket link and scan events", () => {
    const parsed = parseTrackingResponse(sample, AWB);
    expect(parsed).toEqual({
      result: "ok",
      currentStatus: "In Transit",
      estimatedDelivery: "2026-10-30 23:59:00",
      trackUrl: "https://shiprocket.co/tracking/SR1234567890",
      events: [
        { time: "2026-10-28 18:30:00", activity: "In transit script", location: "Pune Hub" },
        { time: "2026-10-27 09:10:00", activity: "Shipment picked up", location: "Mumbai" },
      ],
    });
    expect(JSON.stringify(parsed)).not.toContain("Asha");
  });
  it("accepts the AWB-keyed shape", () => {
    expect(parseTrackingResponse({ [AWB]: sample }, AWB).currentStatus).toBe("In Transit");
  });
  it("reports 'no activity' without inventing a status", () => {
    const parsed = parseTrackingResponse(
      {
        tracking_data: {
          track_status: 0,
          shipment_status: 0,
          shipment_track: [{ current_status: "" }],
          shipment_track_activities: null,
          error: "Aahh! There is no activities found in our DB.",
        },
      },
      AWB,
    );
    expect(parsed).toEqual({
      result: "no_activity",
      currentStatus: null,
      estimatedDelivery: null,
      trackUrl: null,
      events: [],
    });
  });
  it("drops links that are not Shiprocket's", () => {
    expect(
      parseTrackingResponse(
        {
          tracking_data: {
            ...sample.tracking_data,
            track_url: "https://evil.example/shiprocket.co",
          },
        },
        AWB,
      ).trackUrl,
    ).toBeNull();
    expect(
      parseTrackingResponse(
        { tracking_data: { ...sample.tracking_data, track_url: "javascript:alert(1)" } },
        AWB,
      ).trackUrl,
    ).toBeNull();
  });
  it("rejects malformed responses", () => {
    expect(() => parseTrackingResponse("nope", AWB)).toThrow(ShiprocketError);
    expect(() => parseTrackingResponse({ foo: 1 }, AWB)).toThrow(ShiprocketError);
  });
});

describe("Shiprocket client", () => {
  const config = {
    email: "api@example.com",
    password: "pw-not-real",
    baseUrl: "https://apiv2.shiprocket.in",
  };
  const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });

  it("logs in once, reuses the token and only calls the tracking endpoint", async () => {
    const fetchMock = vi.fn(async (url: string, _init?: RequestInit) =>
      url.endsWith("/auth/login") ? json(200, { token: "token-abcdefghijk" }) : json(200, sample),
    );
    const client = createShiprocketClient(config, fetchMock as unknown as typeof fetch);
    await client.trackAwb(AWB);
    await client.trackAwb(AWB);
    const urls = fetchMock.mock.calls.map(([u]) => u);
    expect(urls).toEqual([
      "https://apiv2.shiprocket.in/v1/external/auth/login",
      `https://apiv2.shiprocket.in/v1/external/courier/track/awb/${AWB}`,
      `https://apiv2.shiprocket.in/v1/external/courier/track/awb/${AWB}`,
    ]);
    expect(new Headers(fetchMock.mock.calls[1]?.[1]?.headers).get("authorization")).toBe(
      "Bearer token-abcdefghijk",
    );
    expect(
      fetchMock.mock.calls.every(
        ([, init]) => init?.method === "GET" || String(init?.body).includes("api@example.com"),
      ),
    ).toBe(true);
  });

  it("logs in again once when the token is rejected", async () => {
    let tracks = 0;
    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith("/auth/login")) return json(200, { token: "token-abcdefghijk" });
      tracks += 1;
      return tracks === 1 ? json(401, {}) : json(200, sample);
    });
    const client = createShiprocketClient(config, fetchMock as unknown as typeof fetch);
    expect((await client.trackAwb(AWB)).result).toBe("ok");
    expect(fetchMock.mock.calls.filter(([u]) => String(u).endsWith("/auth/login"))).toHaveLength(2);
  });

  it("handles rate limits, unknown AWBs, outages and bad credentials", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const withTrack = (res: () => Response) =>
      createShiprocketClient(config, (async (url: string) =>
        url.endsWith("/auth/login")
          ? json(200, { token: "token-abcdefghijk" })
          : res()) as unknown as typeof fetch);
    await expect(withTrack(() => json(429, {})).trackAwb(AWB)).rejects.toMatchObject({
      kind: "rate_limited",
    });
    expect((await withTrack(() => json(404, {})).trackAwb(AWB)).result).toBe("not_found");
    await expect(withTrack(() => json(502, {})).trackAwb(AWB)).rejects.toMatchObject({
      kind: "unavailable",
    });
    const badLogin = createShiprocketClient(config, (async () =>
      json(400, { message: "Invalid" })) as unknown as typeof fetch);
    await expect(badLogin.trackAwb(AWB)).rejects.toMatchObject({ kind: "auth" });
    expect(log.mock.calls.flat().join(" ")).not.toContain("pw-not-real");
  });
});

describe("getOrderTracking", () => {
  const USER = "22222222-2222-4222-8222-222222222222";
  const ORDER = "11111111-1111-4111-8111-111111111111";
  const NOW = Date.parse("2026-10-28T12:00:00Z");
  const order = (over: Record<string, unknown> = {}) => ({
    id: ORDER,
    user_id: USER,
    status: "Shipped",
    tracking_number: AWB,
    ...over,
  });
  const userDb = (row: unknown) =>
    ({
      from: () => ({
        select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: row, error: null }) }) }),
      }),
    }) as never;
  function adminDb(cached: Record<string, unknown> | null) {
    const upserts: Record<string, unknown>[] = [];
    const db = {
      from: () => ({
        select: () => ({
          eq: () => ({ maybeSingle: async () => ({ data: cached, error: null }) }),
        }),
        upsert: async (row: Record<string, unknown>) => {
          upserts.push(row);
          return { error: null };
        },
      }),
    };
    return { db: db as never, upserts };
  }
  const snapshot: TrackingSnapshot = {
    result: "ok",
    currentStatus: "In Transit",
    estimatedDelivery: null,
    trackUrl: null,
    events: [{ time: "t", activity: "Picked up", location: "Mumbai" }],
  };
  const tracker = (impl?: () => Promise<TrackingSnapshot>) => ({
    trackAwb: vi.fn(impl ?? (async () => snapshot)),
  });

  it("refuses someone else's order", async () => {
    const t = tracker();
    await expect(
      getOrderTracking(
        {
          userDb: userDb(order({ user_id: "33333333-3333-4333-8333-333333333333" })),
          adminDb: adminDb(null).db,
          tracker: t,
        },
        USER,
        ORDER,
      ),
    ).rejects.toBeInstanceOf(TrackingError);
    await expect(
      getOrderTracking(
        { userDb: userDb(null), adminDb: adminDb(null).db, tracker: t },
        USER,
        ORDER,
      ),
    ).rejects.toThrow(/couldn't find/);
    expect(t.trackAwb).not.toHaveBeenCalled();
  });

  it("returns nothing to track before dispatch", async () => {
    const t = tracker();
    expect(
      await getOrderTracking(
        { userDb: userDb(order({ tracking_number: null })), adminDb: adminDb(null).db, tracker: t },
        USER,
        ORDER,
      ),
    ).toEqual({ state: "not_shipped" });
    expect(
      await getOrderTracking(
        { userDb: userDb(order({ status: "Processing" })), adminDb: adminDb(null).db, tracker: t },
        USER,
        ORDER,
      ),
    ).toEqual({ state: "not_shipped" });
    expect(t.trackAwb).not.toHaveBeenCalled();
  });

  it("shows the tracking number only when live tracking is off", async () => {
    expect(
      await getOrderTracking(
        { userDb: userDb(order()), adminDb: adminDb(null).db, tracker: null },
        USER,
        ORDER,
      ),
    ).toEqual({ state: "manual", awb: AWB });
    expect(
      await getOrderTracking(
        {
          userDb: userDb(order({ tracking_number: "IP 1234" })),
          adminDb: adminDb(null).db,
          tracker: tracker(),
        },
        USER,
        ORDER,
      ),
    ).toEqual({ state: "manual", awb: "IP 1234" });
  });

  it("fetches, caches and then serves from the cache", async () => {
    const t = tracker();
    const { db, upserts } = adminDb(null);
    const first = await getOrderTracking(
      { userDb: userDb(order()), adminDb: db, tracker: t, now: () => NOW },
      USER,
      ORDER,
    );
    expect(first).toMatchObject({
      state: "tracking",
      awb: AWB,
      currentStatus: "In Transit",
      stale: false,
    });
    expect(upserts[0]).toMatchObject({ order_id: ORDER, awb: AWB, last_result: "ok" });
    const fresh = {
      ...upserts[0],
      last_synced_at: new Date(NOW - FRESH_MS + 60_000).toISOString(),
    };
    const t2 = tracker();
    await getOrderTracking(
      { userDb: userDb(order()), adminDb: adminDb(fresh).db, tracker: t2, now: () => NOW },
      USER,
      ORDER,
    );
    expect(t2.trackAwb).not.toHaveBeenCalled();
  });

  it("refetches when the admin changed the AWB", async () => {
    const t = tracker();
    const old = {
      order_id: ORDER,
      awb: "OLD1234567",
      last_result: "ok",
      last_synced_at: new Date(NOW).toISOString(),
      last_attempt_at: new Date(NOW).toISOString(),
      events: [],
    };
    await getOrderTracking(
      { userDb: userDb(order()), adminDb: adminDb(old).db, tracker: t, now: () => NOW },
      USER,
      ORDER,
    );
    expect(t.trackAwb).toHaveBeenCalledWith(AWB);
  });

  it("falls back to saved data, or 'unavailable', when Shiprocket fails, and backs off", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const failing = tracker(async () => {
      throw new ShiprocketError("unavailable");
    });
    const { db, upserts } = adminDb(null);
    expect(
      await getOrderTracking(
        { userDb: userDb(order()), adminDb: db, tracker: failing, now: () => NOW },
        USER,
        ORDER,
      ),
    ).toEqual({ state: "unavailable", awb: AWB });
    expect(upserts[0]).toMatchObject({ last_result: "error", awb: AWB });
    const saved = {
      order_id: ORDER,
      awb: AWB,
      current_status: "In Transit",
      estimated_delivery: null,
      track_url: null,
      events: [{ time: "t", activity: "Picked up", location: "" }],
      last_result: "ok",
      last_synced_at: new Date(NOW - FRESH_MS - 1).toISOString(),
      last_attempt_at: new Date(NOW - FRESH_MS - 1).toISOString(),
    };
    expect(
      await getOrderTracking(
        { userDb: userDb(order()), adminDb: adminDb(saved).db, tracker: failing, now: () => NOW },
        USER,
        ORDER,
      ),
    ).toMatchObject({ state: "tracking", stale: true, currentStatus: "In Transit" });
    const justFailed = {
      ...saved,
      last_attempt_at: new Date(NOW - RETRY_AFTER_FAILURE_MS + 1000).toISOString(),
    };
    const t3 = tracker();
    await getOrderTracking(
      { userDb: userDb(order()), adminDb: adminDb(justFailed).db, tracker: t3, now: () => NOW },
      USER,
      ORDER,
    );
    expect(t3.trackAwb).not.toHaveBeenCalled();
  });

  it("does not change the order (no order writes at all)", async () => {
    const writes = vi.fn();
    const strictUserDb = {
      from: (table: string) => ({
        select: () => ({
          eq: () => ({ maybeSingle: async () => ({ data: order(), error: null }) }),
        }),
        update: writes,
        insert: writes,
        upsert: writes,
        table,
      }),
    } as never;
    await getOrderTracking(
      { userDb: strictUserDb, adminDb: adminDb(null).db, tracker: tracker(), now: () => NOW },
      USER,
      ORDER,
    );
    expect(writes).not.toHaveBeenCalled();
  });
});
