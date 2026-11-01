import { describe, expect, it } from "vitest";
import {
  accountStep,
  emailLinkFailure,
  normalizeProfile,
  phoneIsVerified,
  profileIsComplete,
  readAuthLinkError,
  requiredAccountPage,
  safeNext,
  type CustomerProfile,
} from "./auth";

const complete: CustomerProfile = {
  id: "11111111-1111-4111-8111-111111111111",
  email: "asha@example.com",
  first_name: "Asha",
  last_name: "Rao",
  name: "Asha Rao",
  phone: "+919876543210",
  phone_country: "IN",
  phone_verified_at: null,
};

describe("profiles with missing values (live rows may hold NULL)", () => {
  it("never throws for null, undefined, empty or whitespace-only fields", () => {
    for (const value of [null, undefined, "", "   ", "\t\n"]) {
      const row = { ...complete, first_name: value, last_name: value, phone: value };
      expect(() => profileIsComplete(row)).not.toThrow();
      expect(profileIsComplete(row)).toBe(false);
    }
    expect(profileIsComplete(null)).toBe(false);
    expect(profileIsComplete(undefined)).toBe(false);
    expect(profileIsComplete({})).toBe(false);
  });
  it("needs each of first name, last name and phone", () => {
    expect(profileIsComplete(complete)).toBe(true);
    expect(profileIsComplete({ ...complete, first_name: null })).toBe(false);
    expect(profileIsComplete({ ...complete, last_name: " " })).toBe(false);
    expect(profileIsComplete({ ...complete, phone: undefined })).toBe(false);
    expect(profileIsComplete({ ...complete, first_name: 42 })).toBe(false);
  });
  it("turns a raw row with NULL columns into strings", () => {
    expect(
      normalizeProfile({
        id: complete.id,
        email: null,
        first_name: null,
        last_name: null,
        name: null,
        phone: null,
        phone_country: null,
        phone_verified_at: null,
      }),
    ).toEqual({
      id: complete.id,
      email: "",
      first_name: "",
      last_name: "",
      name: "",
      phone: "",
      phone_country: "",
      phone_verified_at: null,
    });
  });
  it("rejects rows without an id and non-objects", () => {
    expect(normalizeProfile(null)).toBeNull();
    expect(normalizeProfile(undefined)).toBeNull();
    expect(normalizeProfile("x")).toBeNull();
    expect(normalizeProfile({ first_name: "A" })).toBeNull();
  });
  it("treats the mobile number as verified only with a server timestamp", () => {
    expect(phoneIsVerified(complete)).toBe(false);
    expect(phoneIsVerified({ ...complete, phone_verified_at: "" })).toBe(false);
    expect(phoneIsVerified({ ...complete, phone_verified_at: true as never })).toBe(false);
    expect(phoneIsVerified({ ...complete, phone_verified_at: "2026-10-29T10:00:00Z" })).toBe(true);
    expect(phoneIsVerified(null)).toBe(false);
  });
});

describe("account steps and redirects", () => {
  const base = { ready: true, user: { id: complete.id }, profileReady: true, profileError: null };
  it("waits while the session or the profile is loading", () => {
    expect(accountStep({ ...base, ready: false, profile: null })).toBe("loading");
    expect(accountStep({ ...base, profileReady: false, profile: null })).toBe("loading");
  });
  it("reports signed-out visitors", () => {
    expect(accountStep({ ...base, user: null, profile: null })).toBe("signed_out");
  });
  it("shows profile errors instead of redirecting", () => {
    expect(accountStep({ ...base, profileError: "x", profile: null })).toBe("profile_error");
    expect(requiredAccountPage("profile_error")).toBeNull();
  });
  it("asks for missing details first, then the SMS code", () => {
    expect(accountStep({ ...base, profile: null })).toBe("complete_profile");
    expect(accountStep({ ...base, profile: { ...complete, phone: "" } })).toBe("complete_profile");
    expect(accountStep({ ...base, profile: complete })).toBe("verify_phone");
    expect(
      accountStep({ ...base, profile: { ...complete, phone_verified_at: "2026-10-29T10:00:00Z" } }),
    ).toBe("ready");
    expect(requiredAccountPage("complete_profile")).toBe("/complete-profile");
    expect(requiredAccountPage("verify_phone")).toBe("/verify-phone");
    expect(requiredAccountPage("ready")).toBeNull();
    expect(requiredAccountPage("loading")).toBeNull();
    expect(requiredAccountPage("signed_out")).toBeNull();
  });
  it("only returns to same-site pages after signing in", () => {
    expect(safeNext("/checkout")).toBe("/checkout");
    expect(safeNext("https://evil.example")).toBe("/account");
    expect(safeNext("//evil.example")).toBe("/account");
    expect(safeNext(undefined)).toBe("/account");
  });
});

describe("email links (legacy sign-up confirmation and password reset)", () => {
  it("tells sign-up confirmation and reset links apart", () => {
    const link = readAuthLinkError(
      "https://shop.example/reset-password#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired",
    );
    expect(link).toMatchObject({ error: "access_denied", code: "otp_expired" });
    expect(emailLinkFailure(link!, "reset")).toMatch(
      /password reset link is invalid or has expired/,
    );
    expect(emailLinkFailure(link!, "verify")).toMatch(
      /verification link is invalid or has expired/,
    );
  });
  it("ignores addresses without an error", () => {
    expect(readAuthLinkError("https://shop.example/verify?email=a%40b.co")).toBeNull();
    expect(readAuthLinkError("not a url")).toBeNull();
  });
});
