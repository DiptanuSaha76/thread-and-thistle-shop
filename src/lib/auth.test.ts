import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AuthApiError,
  AuthRetryableFetchError,
  AuthUnknownError,
  AuthWeakPasswordError,
} from "@supabase/supabase-js";
import {
  emailLinkFailure,
  emailProblem,
  loginErrors,
  loginFailure,
  nameProblem,
  oauthProviderStatus,
  otpFailure,
  passwordProblem,
  passwordUpdateFailure,
  profileIsComplete,
  readAuthLinkError,
  resendFailure,
  resetRequestFailure,
  safeNext,
  signupErrors,
  signupFailure,
  signupHookMessages,
} from "./auth";
import { AuthSessionMissingError } from "@supabase/supabase-js";

describe("account rules", () => {
  it("requires at least 8 characters", () => {
    expect(passwordProblem("abc1234")).not.toBeNull();
  });
  it("requires a letter and a number", () => {
    expect(passwordProblem("abcdefgh")).not.toBeNull();
    expect(passwordProblem("abcdefg1")).toBeNull();
  });
  it("rejects off-site return destinations", () => {
    expect(safeNext("//evil.com")).toBe("/account");
    expect(safeNext("/checkout")).toBe("/checkout");
  });
});

describe("password requirements", () => {
  it("names the exact requirement that is not met", () => {
    expect(passwordProblem("abc1")).toBe("Password needs at least 8 characters (currently 4)");
    expect(passwordProblem("abcdefgh")).toBe("Password needs at least one number (0–9)");
    expect(passwordProblem("12345678")).toBe("Password needs at least one letter (A–Z)");
  });
  it("lists every unmet requirement together", () => {
    expect(passwordProblem("")).toBe(
      "Password needs at least 8 characters (currently 0), at least one letter (A–Z) and at least one number (0–9)",
    );
    expect(passwordProblem("abc")).toBe(
      "Password needs at least 8 characters (currently 3) and at least one number (0–9)",
    );
  });
  it("accepts valid passwords exactly as typed, including spaces", () => {
    expect(passwordProblem("abcdefg1")).toBeNull();
    expect(passwordProblem(" pass word 9 ")).toBeNull();
  });
});

describe("email syntax", () => {
  it("requires a value and rejects whitespace only", () => {
    expect(emailProblem("")).toBe("Email is required");
    expect(emailProblem("   ")).toBe("Email is required");
  });
  it("rejects malformed addresses", () => {
    for (const bad of ["plainaddress", "a@", "@b.com", "a b@c.com", "a@b", "a@@b.com"]) {
      expect(emailProblem(bad)).toBe("Enter a valid email address");
    }
  });
  it("accepts ordinary addresses and ignores surrounding spaces", () => {
    expect(emailProblem("you@example.com")).toBeNull();
    expect(emailProblem("  first.last+shop@mail.co.in  ")).toBeNull();
  });
});

describe("names", () => {
  it("accepts names from many scripts and common name punctuation", () => {
    for (const ok of [
      "Asha",
      "সৌমিত্র", // Bengali, including vowel signs and a conjunct
      "চট্টোপাধ্যায়",
      "प्रिया", // Devanagari
      "José",
      "Zoë",
      "Mary-Jane",
      "O'Brien",
      "D’Souza",
      "Van der Berg",
      "St. John",
      "李",
    ]) {
      expect(nameProblem(ok, "First name")).toBeNull();
    }
  });
  it("requires a value after trimming", () => {
    expect(nameProblem("", "First name")).toBe("First name is required");
    expect(nameProblem("   ", "Last name")).toBe("Last name is required");
  });
  it("rejects numbers, symbols and punctuation-only values", () => {
    for (const bad of [
      "Asha1",
      "R2D2",
      "Asha!",
      "<script>",
      "a@b",
      "John_Smith",
      "--",
      "'",
      "😀",
    ]) {
      expect(nameProblem(bad, "First name")).toBe(
        "Enter a valid first name using letters, spaces, hyphens or apostrophes",
      );
    }
  });
});

describe("login form", () => {
  it("reports both missing fields together", () => {
    expect(loginErrors("", "")).toEqual({
      email: "Email is required",
      password: "Password is required",
    });
    expect(loginErrors("   ", "   ")).toEqual({
      email: "Email is required",
      password: "Password is required",
    });
  });
  it("reports an invalid email alongside a missing password", () => {
    expect(loginErrors("asha@", "")).toEqual({
      email: "Enter a valid email address",
      password: "Password is required",
    });
  });
  it("does not apply signup strength rules to existing passwords", () => {
    expect(loginErrors("you@example.com", "short")).toEqual({});
  });
});

describe("signup form", () => {
  const valid = {
    first: "Asha",
    last: "Rao",
    country: "IN",
    mobile: "98765 43210",
    email: "asha@example.com",
    password: "abcdefg1",
  };
  it("accepts a complete form", () => {
    expect(signupErrors(valid)).toEqual({});
    expect(signupErrors({ ...valid, country: "GB", mobile: "07700 900123" })).toEqual({});
    expect(signupErrors({ ...valid, first: "সৌমিত্র", last: "চট্টোপাধ্যায়" })).toEqual({});
  });
  it("reports every missing field at once", () => {
    const empty = { first: "", last: "", country: "IN", mobile: "", email: "", password: "" };
    expect(signupErrors(empty)).toEqual({
      first: "First name is required",
      last: "Last name is required",
      mobile: "Mobile number is required",
      email: "Email is required",
      password: "Password is required",
    });
  });
  it("treats whitespace-only values as missing", () => {
    expect(signupErrors({ ...valid, first: "  ", mobile: "   ", password: "         " })).toEqual({
      first: "First name is required",
      mobile: "Mobile number is required",
      password: "Password is required",
    });
  });
  it("reports missing and invalid fields together", () => {
    expect(
      signupErrors({
        ...valid,
        first: "Asha1",
        last: "",
        mobile: "12345",
        email: "asha@",
        password: "abc",
      }),
    ).toEqual({
      first: "Enter a valid first name using letters, spaces, hyphens or apostrophes",
      last: "Last name is required",
      mobile: "Enter a valid mobile number for the selected country",
      email: "Enter a valid email address",
      password: "Password needs at least 8 characters (currently 3) and at least one number (0–9)",
    });
  });
});

// Errors are built the same way @supabase/auth-js builds them from real responses.
const api = (status: number, code: string, message = "raw server text") =>
  new AuthApiError(message, status, code);
const offline = () => new AuthRetryableFetchError("Failed to fetch", 0);
const outage = () => new AuthRetryableFetchError("Bad Gateway", 502);
const NETWORK = "We couldn't connect. Check your internet connection and try again.";
const SERVER = "Our account service is having trouble. Please try again in a few minutes.";

describe("login failures", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("keeps one neutral message for wrong email or password", () => {
    expect(loginFailure(api(400, "invalid_credentials"))).toEqual({
      message: "Email or password is incorrect",
    });
  });
  it("sends unverified accounts to verification using the error code", () => {
    expect(loginFailure(api(400, "email_not_confirmed"))).toEqual({
      message: "Please verify your email first",
      unconfirmed: true,
    });
    // A message that merely mentions "confirm" is no longer treated as unverified.
    expect(
      loginFailure(api(400, "validation_failed", "Please confirm")).unconfirmed,
    ).toBeUndefined();
  });
  it("explains connection problems and outages instead of blaming the password", () => {
    expect(loginFailure(offline())).toEqual({ message: NETWORK });
    expect(loginFailure(outage())).toEqual({ message: SERVER });
    expect(loginFailure(api(504, "request_timeout"))).toEqual({ message: SERVER });
  });
  it("uses the offline signal from the browser", () => {
    vi.stubGlobal("navigator", { onLine: false });
    expect(loginFailure(api(400, "invalid_credentials"))).toEqual({ message: NETWORK });
  });
  it("explains rate limits by code or HTTP 429", () => {
    const limited = {
      message: "Too many login attempts. Please wait a few minutes and try again.",
    };
    expect(loginFailure(api(429, "over_request_rate_limit"))).toEqual(limited);
    expect(loginFailure(api(429, "some_future_code"))).toEqual(limited);
  });
  it("never shows raw server text for unexpected errors", () => {
    const generic = { message: "We couldn't log you in. Please try again." };
    expect(loginFailure(api(400, "user_banned", "User is banned"))).toEqual(generic);
    expect(loginFailure(new AuthUnknownError("Unexpected token <", {}))).toEqual(generic);
    expect(loginFailure(new Error("boom"))).toEqual(generic);
    expect(loginFailure("not even an error")).toEqual(generic);
  });
});

describe("signup failures", () => {
  it("replaces 'Failed to fetch' and outages with friendly messages", () => {
    expect(signupFailure(offline())).toEqual({ message: NETWORK });
    expect(signupFailure(outage())).toEqual({ message: SERVER });
  });
  it("explains rate limits, including the email-sending limit", () => {
    expect(signupFailure(api(429, "over_email_send_rate_limit"))).toEqual({
      message: "We've sent too many emails recently. Please wait a few minutes and try again.",
    });
    expect(signupFailure(api(429, "over_request_rate_limit"))).toEqual({
      message: "Too many sign-up attempts. Please wait a few minutes and try again.",
    });
  });
  it("puts server password rejections under the password field", () => {
    expect(signupFailure(new AuthWeakPasswordError("weak", 422, ["pwned"]))).toEqual({
      field: "password",
      message: "This password has appeared in a known data breach. Please choose a different one.",
    });
    expect(signupFailure(new AuthWeakPasswordError("weak", 422, ["length"])).field).toBe(
      "password",
    );
    expect(signupFailure(new AuthWeakPasswordError("weak", 422, ["characters"])).message).toMatch(
      /stronger password/,
    );
  });
  it("keeps duplicate-email failures neutral", () => {
    for (const code of ["user_already_exists", "email_exists"]) {
      const { message, field } = signupFailure(api(422, code, "User already registered"));
      expect(field).toBeUndefined();
      expect(message).toContain("If you already have an account");
      expect(message).not.toMatch(/already registered|already exists|is taken/i);
    }
  });
  it("handles other known signup failures", () => {
    expect(signupFailure(api(400, "email_address_invalid"))).toEqual({
      field: "email",
      message: "This email address can't be used. Please try a different one.",
    });
    expect(signupFailure(api(400, "email_address_not_authorized")).message).toMatch(
      /can't send a verification email/,
    );
    expect(signupFailure(api(422, "signup_disabled")).message).toMatch(
      /can't be created right now/,
    );
  });
  it("never shows raw server text for unexpected errors", () => {
    const generic = { message: "We couldn't create your account. Please try again." };
    expect(signupFailure(api(400, "captcha_failed", "captcha protection: x"))).toEqual(generic);
    expect(signupFailure(new Error("boom"))).toEqual(generic);
  });
});

describe("safe redirects", () => {
  it("rejects protocol-relative and backslash tricks", () => {
    expect(safeNext("/\\evil.com")).toBe("/account");
    expect(safeNext("/ok\nLocation: x")).toBe("/account");
    expect(safeNext("https://evil.com")).toBe("/account");
    expect(safeNext("/checkout?step=2")).toBe("/checkout?step=2");
  });
});

describe("profile completeness", () => {
  const base = {
    id: "u",
    email: "a@b.co",
    first_name: "Asha",
    last_name: "Rao",
    name: "Asha Rao",
    phone: "+919876543210",
    phone_country: "IN",
  };
  it("needs first name, last name and phone", () => {
    expect(profileIsComplete(base)).toBe(true);
    expect(profileIsComplete({ ...base, phone: "" })).toBe(false);
    expect(profileIsComplete({ ...base, last_name: " " })).toBe(false);
    expect(profileIsComplete(null)).toBe(false);
  });
});

describe("sign-up hook messages", () => {
  it("are shown under the matching field", () => {
    for (const hook of signupHookMessages) {
      expect(signupFailure(new AuthApiError(hook.message, 400, undefined))).toEqual({
        field: hook.field,
        message: hook.message,
      });
    }
  });
  it("are only trusted on client-error statuses", () => {
    expect(
      signupFailure(new AuthApiError(signupHookMessages[0].message, 500, undefined)).field,
    ).toBeUndefined();
  });
});

describe("verification, resend and password reset failures", () => {
  it("explains wrong or expired codes", () => {
    expect(otpFailure(api(403, "otp_expired")).message).toMatch(/invalid or has expired/);
    expect(otpFailure(offline()).message).toBe(NETWORK);
  });
  it("explains resend limits", () => {
    expect(resendFailure(api(429, "over_email_send_rate_limit")).message).toMatch(/wait a minute/);
  });
  it("keeps forgot-password neutral except for connection problems and rate limits", () => {
    expect(resetRequestFailure(api(400, "user_not_found"))).toBeNull();
    expect(resetRequestFailure(api(400, "validation_failed"))).toBeNull();
    expect(resetRequestFailure(offline())).toEqual({ message: NETWORK });
    expect(resetRequestFailure(api(429, "over_email_send_rate_limit"))?.message).toMatch(
      /wait a minute/,
    );
  });
  it("explains new-password problems", () => {
    expect(passwordUpdateFailure(api(422, "same_password"))).toEqual({
      field: "password",
      message: "Choose a password that is different from your current one.",
    });
    expect(passwordUpdateFailure(new AuthWeakPasswordError("weak", 422, ["pwned"])).field).toBe(
      "password",
    );
    expect(passwordUpdateFailure(new AuthSessionMissingError()).message).toMatch(
      /link is invalid or has expired/,
    );
    expect(passwordUpdateFailure(new Error("boom")).message).toBe(
      "We couldn't update your password. Please try again.",
    );
  });
});

describe("email link errors", () => {
  const expired =
    "https://shop.example/reset-password#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired";
  it("reads Supabase's error from the hash or the query", () => {
    expect(readAuthLinkError(expired)).toEqual({
      error: "access_denied",
      code: "otp_expired",
      description: "Email link is invalid or has expired",
    });
    expect(readAuthLinkError("https://shop.example/verify?email=a%40b.c&error=server_error")?.error).toBe(
      "server_error",
    );
    expect(readAuthLinkError("https://shop.example/verify?email=a%40b.c")).toBeNull();
    expect(readAuthLinkError("https://shop.example/reset-password#access_token=x&type=recovery")).toBeNull();
    expect(readAuthLinkError("not a url")).toBeNull();
  });
  it("explains expired links without showing Supabase's own text", () => {
    const link = readAuthLinkError(expired)!;
    expect(emailLinkFailure(link, "reset")).toBe(
      "This password reset link is invalid or has expired. Please request a new one.",
    );
    expect(emailLinkFailure(link, "verify")).toMatch(/verification link is invalid or has expired/);
    const odd = { error: "server_error", code: "unexpected_failure", description: "pq: relation does not exist" };
    expect(emailLinkFailure(odd, "reset")).not.toMatch(/pq:|relation/);
    expect(emailLinkFailure(odd, "verify")).not.toMatch(/pq:|relation/);
  });
});

describe("Google/Apple availability check", () => {
  const settings = (body: unknown, status = 200) =>
    vi.fn(async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;
  const opts = { url: "https://ref.supabase.co/", key: "sb_publishable_test" };
  it("reports whether the provider is switched on in Supabase", async () => {
    const fetchImpl = settings({ external: { google: true, apple: false } });
    expect(await oauthProviderStatus("google", { ...opts, fetchImpl })).toBe("enabled");
    expect(await oauthProviderStatus("apple", { ...opts, fetchImpl })).toBe("disabled");
    const [url, init] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://ref.supabase.co/auth/v1/settings");
    expect(new Headers(init.headers).get("apikey")).toBe("sb_publishable_test");
  });
  it("does not block sign-in when the check itself fails", async () => {
    expect(await oauthProviderStatus("google", { ...opts, fetchImpl: settings({}, 500) })).toBe("unknown");
    expect(await oauthProviderStatus("google", { ...opts, fetchImpl: settings({ other: 1 }) })).toBe("unknown");
    const offlineFetch = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    }) as unknown as typeof fetch;
    expect(await oauthProviderStatus("google", { ...opts, fetchImpl: offlineFetch })).toBe("unknown");
    expect(await oauthProviderStatus("google", { url: "", key: "", fetchImpl: offlineFetch })).toBe("unknown");
  });
});
