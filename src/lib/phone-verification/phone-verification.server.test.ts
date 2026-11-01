import { describe, expect, it, vi } from "vitest";
import {
  clientIp,
  createPhoneVerification,
  ipHash,
  maskPhone,
  otpHash,
  phoneVerificationConfig,
  PhoneVerificationError,
} from "./phone-verification.server";
import { sendOutcomeMessage, verifyOutcomeMessage } from "./messages";

// The database and OneAPI are both fakes here: no real database, no real SMS.
const USER = "22222222-2222-4222-8222-222222222222";
const SECRET = "s".repeat(40);
const config = {
  sms: {
    apiKey: "test-key-not-real",
    brandName: "YEARTH",
    endpoint: "https://backend.oneapi.in/sms/sendotp",
  },
  secret: SECRET,
};
type Profile = {
  phone: string;
  phone_country: string;
  phone_verified_at: string | null;
  first_name: string;
};
const indian: Profile = {
  phone: "+919876543210",
  phone_country: "IN",
  phone_verified_at: null,
  first_name: "Asha",
};

function fakeDb(
  profile: Profile | null,
  rpcReplies: Record<string, unknown> = {},
  /** Another account has already verified the same number. */
  verifiedElsewhere = false,
) {
  const rpc = vi.fn(async (name: string, _args: Record<string, unknown>) => {
    const reply = rpcReplies[name];
    if (reply instanceof Error) return { data: null, error: { message: reply.message } };
    return { data: reply ?? null, error: null };
  });
  const profileFilter = vi.fn();
  const db = {
    rpc,
    from: (table: string) => ({
      select: () => ({
        eq: (column: string, value: string) => {
          profileFilter(table, column, value);
          // The "same number verified on another account" lookup: .not().neq().limit().
          const others = {
            not: () => others,
            neq: () => others,
            limit: async () => ({ data: verifiedElsewhere ? [{ id: "other" }] : [], error: null }),
          };
          return { maybeSingle: async () => ({ data: profile, error: null }), ...others };
        },
      }),
    }),
  };
  return { db: db as never, rpc, profileFilter };
}
const okSms = () =>
  vi.fn(async () => new Response(JSON.stringify({ success: true }), { status: 200 }));

describe("configuration", () => {
  it("stays off without the SMS key, brand name and a long hashing secret", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(phoneVerificationConfig({})).toBeNull();
    expect(
      phoneVerificationConfig({ ONEAPI_SMS_API_KEY: "k", ONEAPI_SMS_BRAND_NAME: "B" }),
    ).toBeNull();
    expect(
      phoneVerificationConfig({
        ONEAPI_SMS_API_KEY: "k",
        ONEAPI_SMS_BRAND_NAME: "B",
        PHONE_OTP_SECRET: "short",
      }),
    ).toBeNull();
    expect(
      phoneVerificationConfig({
        ONEAPI_SMS_API_KEY: "k",
        ONEAPI_SMS_BRAND_NAME: "B",
        PHONE_OTP_SECRET: SECRET,
      }),
    ).not.toBeNull();
  });
});

describe("helpers", () => {
  it("hashes codes with the secret, bound to user and number", () => {
    const h = otpHash(SECRET, USER, "+919876543210", "482913");
    expect(h).toMatch(/^[a-f0-9]{64}$/);
    expect(h).not.toContain("482913");
    expect(otpHash("t".repeat(40), USER, "+919876543210", "482913")).not.toBe(h);
    expect(otpHash(SECRET, USER, "+919876543211", "482913")).not.toBe(h);
    expect(ipHash(SECRET, null)).toBeNull();
    expect(ipHash(SECRET, "203.0.113.5")).toMatch(/^[a-f0-9]{64}$/);
  });
  it("masks numbers", () => {
    expect(maskPhone("+919876543210")).toBe("+91 ••••••3210");
    expect(maskPhone("+447700900123")).toBe("+44 ••••••0123");
    expect(maskPhone("+9715xxxx")).toContain("+971");
  });
  it("reads the client IP from platform headers and ignores junk", () => {
    expect(
      clientIp(new Headers({ "cf-connecting-ip": "203.0.113.5", "x-forwarded-for": "1.1.1.1" })),
    ).toBe("203.0.113.5");
    expect(clientIp(new Headers({ "x-forwarded-for": "198.51.100.7, 10.0.0.1" }))).toBe(
      "198.51.100.7",
    );
    expect(clientIp(new Headers({ "x-forwarded-for": "<script>" }))).toBeNull();
    expect(clientIp(null)).toBeNull();
  });
});

describe("sendCode", () => {
  it("sends to the number saved on the signed-in customer's profile only", async () => {
    const { db, rpc, profileFilter } = fakeDb(indian, {
      phone_otp_begin: { ok: true, resend_in: 60, expires_in: 600 },
    });
    const sms = okSms();
    const service = createPhoneVerification({
      db,
      config,
      fetchImpl: sms,
      generateCode: () => "482913",
    });
    const result = await service.sendCode(USER, "203.0.113.5");
    expect(result).toEqual({
      status: "sent",
      resendIn: 60,
      expiresIn: 600,
      phoneMasked: "+91 ••••••3210",
    });
    expect(profileFilter).toHaveBeenCalledWith("profiles", "id", USER);
    const begin = rpc.mock.calls.find(([name]) => name === "phone_otp_begin")![1];
    expect(begin).toMatchObject({
      p_user: USER,
      p_phone: "+919876543210",
      p_otp_hash: otpHash(SECRET, USER, "+919876543210", "482913"),
      p_ip_hash: ipHash(SECRET, "203.0.113.5"),
    });
    expect(JSON.stringify(begin)).not.toContain("482913");
    const body = JSON.parse(
      String((sms.mock.calls[0] as unknown as [string, RequestInit])[1].body),
    );
    expect(body).toMatchObject({
      number: 9876543210,
      otp: 482913,
      customerName: "Asha",
      brandName: "YEARTH",
    });
    expect(rpc).toHaveBeenCalledWith("phone_otp_mark_sent", {
      p_challenge: begin["p_challenge"],
      p_sent: true,
    });
  });

  it("generates 6-digit codes without a leading zero", async () => {
    const codes = new Set<string>();
    for (let i = 0; i < 200; i++) {
      const { db } = fakeDb(indian, { phone_otp_begin: { ok: true } });
      const sms = okSms();
      await createPhoneVerification({ db, config, fetchImpl: sms }).sendCode(USER, null);
      codes.add(
        String(
          JSON.parse(String((sms.mock.calls[0] as unknown as [string, RequestInit])[1].body)).otp,
        ),
      );
    }
    for (const c of codes) expect(c).toMatch(/^[1-9]\d{5}$/);
    expect(codes.size).toBeGreaterThan(190);
  });

  it("records a provider failure and tells the customer to retry", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { db, rpc } = fakeDb(indian, { phone_otp_begin: { ok: true } });
    const failing = vi.fn(
      async () =>
        new Response(JSON.stringify({ success: false, msg: "low balance" }), { status: 200 }),
    );
    await expect(
      createPhoneVerification({ db, config, fetchImpl: failing }).sendCode(USER, null),
    ).rejects.toThrow(/couldn't send the code/);
    expect(rpc).toHaveBeenCalledWith(
      "phone_otp_mark_sent",
      expect.objectContaining({ p_sent: false }),
    );
  });

  it("maps the database limits", async () => {
    const run = async (reply: unknown) => {
      const { db } = fakeDb(indian, { phone_otp_begin: reply });
      const sms = okSms();
      const result = await createPhoneVerification({ db, config, fetchImpl: sms }).sendCode(
        USER,
        null,
      );
      expect(sms).not.toHaveBeenCalled();
      return result;
    };
    expect(await run({ ok: false, reason: "COOLDOWN", retry_after: 42 })).toEqual({
      status: "cooldown",
      resendIn: 42,
    });
    expect(await run({ ok: false, reason: "RATE_LIMITED", retry_after: 1800 })).toEqual({
      status: "rate_limited",
      retryAfter: 1800,
    });
    expect(await run({ ok: false, reason: "ALREADY_VERIFIED" })).toEqual({
      status: "already_verified",
    });
  });

  it("refuses when unconfigured, without a phone, or for numbers outside India", async () => {
    const sms = okSms();
    await expect(
      createPhoneVerification({ db: fakeDb(indian).db, config: null, fetchImpl: sms }).sendCode(
        USER,
        null,
      ),
    ).rejects.toBeInstanceOf(PhoneVerificationError);
    await expect(
      createPhoneVerification({
        db: fakeDb({ ...indian, phone: "" }).db,
        config,
        fetchImpl: sms,
      }).sendCode(USER, null),
    ).rejects.toThrow(/Add your mobile number/);
    await expect(
      createPhoneVerification({
        db: fakeDb({ ...indian, phone: "+447700900123", phone_country: "GB" }).db,
        config,
        fetchImpl: sms,
      }).sendCode(USER, null),
    ).rejects.toThrow(/\+91/);
    expect(sms).not.toHaveBeenCalled();
  });

  it("does not resend to an already verified number", async () => {
    const { db, rpc } = fakeDb({ ...indian, phone_verified_at: "2026-10-28T00:00:00Z" });
    expect(
      await createPhoneVerification({ db, config, fetchImpl: okSms() }).sendCode(USER, null),
    ).toEqual({ status: "already_verified" });
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe("verifyCode", () => {
  const verifyWith = async (reply: unknown, code = "482913") => {
    const { db, rpc } = fakeDb(indian, { phone_otp_verify: reply });
    const result = await createPhoneVerification({ db, config }).verifyCode(USER, code);
    return { result, rpc };
  };
  it("sends only the hash of the code to the database", async () => {
    const { result, rpc } = await verifyWith({ ok: true, reason: "VERIFIED" });
    expect(result).toEqual({ status: "verified" });
    expect(rpc).toHaveBeenCalledWith("phone_otp_verify", {
      p_user: USER,
      p_otp_hash: otpHash(SECRET, USER, "+919876543210", "482913"),
    });
  });
  it("maps incorrect, locked, expired and missing codes", async () => {
    expect((await verifyWith({ ok: false, reason: "INCORRECT", attempts_left: 3 })).result).toEqual(
      { status: "incorrect", attemptsLeft: 3 },
    );
    expect((await verifyWith({ ok: false, reason: "LOCKED" })).result).toEqual({
      status: "locked",
    });
    expect((await verifyWith({ ok: false, reason: "EXPIRED" })).result).toEqual({
      status: "expired",
    });
    expect((await verifyWith({ ok: false, reason: "NO_ACTIVE_CODE" })).result).toEqual({
      status: "no_code",
    });
  });
  it("rejects malformed codes before touching the database", async () => {
    const { db, rpc } = fakeDb(indian);
    await expect(createPhoneVerification({ db, config }).verifyCode(USER, "12345")).rejects.toThrow(
      /6-digit/,
    );
    await expect(
      createPhoneVerification({ db, config }).verifyCode(USER, "12345a"),
    ).rejects.toThrow(/6-digit/);
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe("getStatus", () => {
  it("reports disabled without calling the database functions", async () => {
    const { db, rpc } = fakeDb(indian);
    expect(await createPhoneVerification({ db, config: null }).getStatus(USER)).toMatchObject({
      enabled: false,
      hasPhone: true,
      supported: true,
      verified: false,
    });
    expect(rpc).not.toHaveBeenCalled();
  });
  it("includes the resend countdown", async () => {
    const { db } = fakeDb(indian, { phone_otp_status: { resend_in: 37, code_active: true } });
    expect(await createPhoneVerification({ db, config }).getStatus(USER)).toEqual({
      enabled: true,
      hasPhone: true,
      supported: true,
      verified: false,
      phoneMasked: "+91 ••••••3210",
      resendIn: 37,
      codeActive: true,
    });
  });
});

describe("messages", () => {
  it("explains each outcome", () => {
    expect(sendOutcomeMessage({ status: "rate_limited", retryAfter: 1800 })).toContain(
      "30 minutes",
    );
    expect(sendOutcomeMessage({ status: "cooldown", resendIn: 20 })).toContain("20 seconds");
    expect(verifyOutcomeMessage({ status: "incorrect", attemptsLeft: 1 })).toBe(
      "That code is incorrect. 1 attempt left.",
    );
    expect(verifyOutcomeMessage({ status: "verified" })).toBeNull();
    expect(verifyOutcomeMessage({ status: "locked" })).toContain("new code");
  });
});

describe("one verified mobile number per account", () => {
  it("does not send a code for a number already verified on another account", async () => {
    const sms = okSms();
    const { db, rpc } = fakeDb(indian, { phone_otp_begin: { ok: true } }, true);
    await expect(
      createPhoneVerification({ db, config, fetchImpl: sms }).sendCode(USER, null),
    ).rejects.toThrow(/can't be used for this account/);
    expect(rpc).not.toHaveBeenCalled();
    expect(sms).not.toHaveBeenCalled();
  });
  it("does not accept a code for a number verified on another account in the meantime", async () => {
    const { db, rpc } = fakeDb(
      indian,
      { phone_otp_verify: { ok: true, reason: "VERIFIED" } },
      true,
    );
    await expect(
      createPhoneVerification({ db, config }).verifyCode(USER, "482913"),
    ).rejects.toThrow(/can't be used for this account/);
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe("profile rows with NULL values", () => {
  const nullRow = {
    phone: null,
    phone_country: null,
    phone_verified_at: null,
    first_name: null,
  } as unknown as Profile;
  it("reports no phone instead of failing", async () => {
    const { db } = fakeDb(nullRow);
    await expect(createPhoneVerification({ db, config }).getStatus(USER)).resolves.toMatchObject({
      enabled: true,
      hasPhone: false,
      verified: false,
      phoneMasked: null,
    });
    await expect(
      createPhoneVerification({ db, config, fetchImpl: okSms() }).sendCode(USER, null),
    ).rejects.toThrow(/Add your mobile number/);
  });
  it("sends to a saved number even when the first name is NULL", async () => {
    const sms = okSms();
    const { db } = fakeDb({ ...indian, first_name: null } as unknown as Profile, {
      phone_otp_begin: { ok: true },
    });
    await expect(
      createPhoneVerification({ db, config, fetchImpl: sms }).sendCode(USER, null),
    ).resolves.toMatchObject({ status: "sent" });
    const body = JSON.parse(
      String((sms.mock.calls[0] as unknown as [string, RequestInit])[1].body),
    );
    expect(body.customerName).toBe("Customer");
  });
});
