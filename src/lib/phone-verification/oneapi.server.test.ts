import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ONEAPI_DEFAULT_ENDPOINT,
  oneApiConfig,
  sendOneApiOtp,
  smsCustomerName,
} from "./oneapi.server";

// Every test uses a mocked fetch: no SMS is ever sent.
const config = {
  apiKey: "test-key-not-real",
  brandName: "YEARTH",
  endpoint: ONEAPI_DEFAULT_ENDPOINT,
};
const message = { nationalNumber: "9876543210", otp: "482913", customerName: "Asha" };
const reply = (status: number, body: string) => vi.fn(async () => new Response(body, { status }));

afterEach(() => vi.restoreAllMocks());

describe("oneApiConfig", () => {
  it("is off until both the key and the approved brand name are set", () => {
    expect(oneApiConfig({})).toBeNull();
    expect(oneApiConfig({ ONEAPI_SMS_API_KEY: "k" })).toBeNull();
    expect(oneApiConfig({ ONEAPI_SMS_BRAND_NAME: "YEARTH" })).toBeNull();
    expect(oneApiConfig({ ONEAPI_SMS_API_KEY: "k", ONEAPI_SMS_BRAND_NAME: "YEARTH" })).toEqual({
      apiKey: "k",
      brandName: "YEARTH",
      endpoint: ONEAPI_DEFAULT_ENDPOINT,
    });
  });
  it("never defaults to the documentation's example brand", () => {
    expect(oneApiConfig({ ONEAPI_SMS_API_KEY: "k" })?.brandName).toBeUndefined();
  });
  it("refuses a non-https endpoint override (except a local test server)", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const base = { ONEAPI_SMS_API_KEY: "k", ONEAPI_SMS_BRAND_NAME: "B" };
    expect(oneApiConfig({ ...base, ONEAPI_SMS_ENDPOINT: "http://evil.example/x" })).toBeNull();
    expect(oneApiConfig({ ...base, ONEAPI_SMS_ENDPOINT: "http://127.0.0.1:9/x" })?.endpoint).toBe(
      "http://127.0.0.1:9/x",
    );
  });
});

describe("sendOneApiOtp", () => {
  it("sends the documented request body and reports success only for success:true", async () => {
    const fetchMock = reply(200, JSON.stringify({ success: true, msg: "OTP send successfully!" }));
    await expect(sendOneApiOtp(config, message, fetchMock)).resolves.toEqual({ ok: true });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://backend.oneapi.in/sms/sendotp");
    expect(init.method).toBe("POST");
    expect(new Headers(init.headers).get("content-type")).toBe("application/json");
    expect(JSON.parse(String(init.body))).toEqual({
      apiKey: "test-key-not-real",
      brandName: "YEARTH",
      customerName: "Asha",
      number: 9876543210,
      otp: 482913,
    });
  });

  it.each([
    ["HTTP error", reply(500, "oops"), "http"],
    ["malformed JSON", reply(200, "<html>"), "bad_response"],
    [
      "success:false",
      reply(
        200,
        JSON.stringify({ success: false, msg: "Invalid apiKey test-key-not-real 9876543210" }),
      ),
      "rejected",
    ],
    ["missing success flag", reply(200, JSON.stringify({ msg: "ok" })), "rejected"],
    ["success as a string", reply(200, JSON.stringify({ success: "true" })), "rejected"],
  ])("treats %s as a failure", async (_label, fetchMock, reason) => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const result = await sendOneApiOtp(config, message, fetchMock);
    expect(result).toMatchObject({ ok: false, reason });
    const logged = log.mock.calls.flat().join(" ");
    expect(logged).not.toContain("test-key-not-real");
    expect(logged).not.toContain("9876543210");
    expect(logged).not.toContain("482913");
  });

  it("handles network errors and timeouts", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const network = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });
    await expect(sendOneApiOtp(config, message, network)).resolves.toEqual({
      ok: false,
      reason: "network",
    });
    const timeout = vi.fn(async () => {
      throw Object.assign(new Error("timed out"), { name: "TimeoutError" });
    });
    await expect(sendOneApiOtp(config, message, timeout)).resolves.toEqual({
      ok: false,
      reason: "timeout",
    });
  });

  it("refuses to send malformed numbers or codes", async () => {
    const fetchMock = reply(200, JSON.stringify({ success: true }));
    expect(
      (await sendOneApiOtp(config, { ...message, nationalNumber: "+919876543210" }, fetchMock)).ok,
    ).toBe(false);
    expect((await sendOneApiOtp(config, { ...message, otp: "012345" }, fetchMock)).ok).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("smsCustomerName", () => {
  it("keeps letters (any script) and trims to 30 characters", () => {
    expect(smsCustomerName("Asha")).toBe("Asha");
    expect(smsCustomerName("সৌমিত্র")).toBe("সৌমিত্র");
    expect(smsCustomerName("<b>Asha</b> 123 {#var#}")).toBe("bAshab var");
    expect(smsCustomerName("A".repeat(50))).toHaveLength(30);
    expect(smsCustomerName("")).toBe("Customer");
    expect(smsCustomerName(null)).toBe("Customer");
  });
});
