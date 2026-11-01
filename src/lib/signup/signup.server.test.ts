import { afterEach, describe, expect, it, vi } from "vitest";
import {
  checkSignup,
  readSignsInImmediately,
  SIGNUP_CHECK_FAILED,
  SIGNUP_UNAVAILABLE,
  type SignupDeps,
} from "./signup.server";

// Everything external is a fake: no database, no Supabase, no SMS.
vi.mock("@/integrations/supabase/client.server", () => ({ supabaseAdmin: {} }));

const valid = {
  first: "Asha",
  last: "Rao",
  email: "asha@example.com",
  country: "IN",
  mobile: "98765 43210",
};
const deps = (over: Partial<SignupDeps> = {}): SignupDeps => ({
  smsReady: () => true,
  emailVerdict: async () => "ok",
  signsInImmediately: async () => true,
  ...over,
});

afterEach(() => vi.restoreAllMocks());

describe("sign-up check", () => {
  it("accepts complete details and returns the normalised number", async () => {
    await expect(checkSignup(valid, deps())).resolves.toEqual({ ok: true, phone: "+919876543210" });
  });

  it.each([
    ["first", { first: " " }, /First name is required/],
    ["last", { last: "R2D2" }, /valid last name/],
    ["mobile", { mobile: "" }, /Mobile number is required/],
    ["mobile", { mobile: "12345" }, /valid mobile number/],
    ["email", { email: "" }, /Email is required/],
    ["email", { email: "not-an-email" }, /valid email/],
  ])("puts problems under the %s field", async (field, change, message) => {
    const result = await checkSignup({ ...valid, ...change }, deps());
    expect(result).toMatchObject({ ok: false, field });
    expect(!result.ok && result.message).toMatch(message);
  });

  it("does not assume ten-digit numbers: other countries are validated by their own rules", async () => {
    // A valid UK mobile passes number validation but SMS is only available for India.
    const result = await checkSignup({ ...valid, country: "GB", mobile: "07700 900123" }, deps());
    expect(result).toMatchObject({ ok: false, field: "mobile" });
    expect(!result.ok && result.message).toMatch(/Indian \(\+91\) mobile numbers only/);
  });

  it("rejects temporary email providers", async () => {
    const result = await checkSignup(valid, deps({ emailVerdict: async () => "disposable" }));
    expect(result).toMatchObject({ ok: false, field: "email" });
    expect(!result.ok && result.message).toMatch(/permanent email address/);
  });

  it("continues when the early email check itself fails (the sign-up hook still enforces it)", async () => {
    await expect(
      checkSignup(valid, deps({ emailVerdict: async () => null })),
    ).resolves.toMatchObject({
      ok: true,
    });
  });

  it("refuses with a configuration message when SMS sending is not set up", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const signsIn = vi.fn(async () => true);
    const result = await checkSignup(
      valid,
      deps({ smsReady: () => false, signsInImmediately: signsIn }),
    );
    expect(result).toEqual({ ok: false, message: SIGNUP_UNAVAILABLE });
    expect(log.mock.calls.flat().join(" ")).toMatch(/ONEAPI_SMS_API_KEY/);
  });

  it("refuses instead of falling back to an email link when Supabase 'Confirm email' is on", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const result = await checkSignup(valid, deps({ signsInImmediately: async () => false }));
    expect(result).toEqual({ ok: false, message: SIGNUP_UNAVAILABLE });
    expect(log.mock.calls.flat().join(" ")).toMatch(/Confirm email/);
  });

  it("refuses when the Supabase setting cannot be read", async () => {
    await expect(
      checkSignup(valid, deps({ signsInImmediately: async () => null })),
    ).resolves.toEqual({ ok: false, message: SIGNUP_CHECK_FAILED });
  });
});

describe("reading Supabase's sign-up setting", () => {
  const env = { SUPABASE_URL: "https://proj.supabase.co/", SUPABASE_PUBLISHABLE_KEY: "pk-test" };
  const reply = (status: number, body: unknown) =>
    vi.fn(async () => new Response(JSON.stringify(body), { status }));

  it("reads mailer_autoconfirm from the public settings endpoint", async () => {
    const on = reply(200, { mailer_autoconfirm: true });
    await expect(readSignsInImmediately(env, on)).resolves.toBe(true);
    const [url, init] = on.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://proj.supabase.co/auth/v1/settings");
    expect(new Headers(init.headers).get("apikey")).toBe("pk-test");
    await expect(
      readSignsInImmediately(env, reply(200, { mailer_autoconfirm: false })),
    ).resolves.toBe(false);
  });

  it("returns null for errors, odd replies, network failures and missing configuration", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(readSignsInImmediately(env, reply(500, {}))).resolves.toBeNull();
    await expect(
      readSignsInImmediately(env, reply(200, { mailer_autoconfirm: "yes" })),
    ).resolves.toBeNull();
    const offline = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });
    await expect(readSignsInImmediately(env, offline)).resolves.toBeNull();
    await expect(
      readSignsInImmediately({}, reply(200, { mailer_autoconfirm: true })),
    ).resolves.toBeNull();
  });
});
