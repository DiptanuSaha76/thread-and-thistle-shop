import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useNavigate, useRouter } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import {
  isAuthApiError,
  isAuthError,
  isAuthRetryableFetchError,
  isAuthSessionMissingError,
  isAuthWeakPasswordError,
  type User,
} from "@supabase/supabase-js";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { normalizePhone } from "@/lib/phone";

/**
 * The customer's own profile row (public.profiles), the source of truth for name and phone.
 * Always built with normalizeProfile(): text fields are never null here, even though the live
 * table allows NULL (rows created by the profile back-fill only set id, email and name).
 */
export type CustomerProfile = {
  id: string;
  email: string;
  first_name: string;
  last_name: string;
  name: string;
  phone: string;
  phone_country: string;
  /** Set by the server only (public.phone_otp_verify) once the SMS code was confirmed. */
  phone_verified_at: string | null;
};

const textOrEmpty = (value: unknown) => (typeof value === "string" ? value : "");

/** Turns a raw profiles row (any field may be null or missing) into a CustomerProfile. */
export function normalizeProfile(row: unknown): CustomerProfile | null {
  if (!row || typeof row !== "object") return null;
  const r = row as Record<string, unknown>;
  const id = textOrEmpty(r["id"]);
  if (!id) return null;
  const verifiedAt = r["phone_verified_at"];
  return {
    id,
    email: textOrEmpty(r["email"]),
    first_name: textOrEmpty(r["first_name"]),
    last_name: textOrEmpty(r["last_name"]),
    name: textOrEmpty(r["name"]),
    phone: textOrEmpty(r["phone"]),
    phone_country: textOrEmpty(r["phone_country"]),
    phone_verified_at: typeof verifiedAt === "string" && verifiedAt ? verifiedAt : null,
  };
}

type ProfileLike = Partial<Record<"first_name" | "last_name" | "phone", unknown>>;
const hasText = (value: unknown) => typeof value === "string" && value.trim().length > 0;

/** Orders and the account area need a name and a phone number. Safe for null/partial rows. */
export const profileIsComplete = (p: ProfileLike | null | undefined) =>
  !!p && hasText(p.first_name) && hasText(p.last_name) && hasText(p.phone);

/** True only when the server has recorded a confirmed SMS code for the profile's number. */
export const phoneIsVerified = (p: { phone_verified_at?: unknown } | null | undefined) =>
  !!p && typeof p.phone_verified_at === "string" && p.phone_verified_at.length > 0;

/**
 * Where a visitor stands, in the order the store checks it:
 * "loading" (session or profile not known yet), "signed_out", "profile_error" (the page shows the
 * error and does not redirect), "complete_profile" (name or mobile missing), "verify_phone" (the
 * mobile number is not confirmed by SMS yet), "ready".
 */
export type AccountStep =
  "loading" | "signed_out" | "profile_error" | "complete_profile" | "verify_phone" | "ready";

export function accountStep(state: {
  ready: boolean;
  user: unknown;
  profileReady: boolean;
  profileError: string | null;
  profile: CustomerProfile | null;
}): AccountStep {
  if (!state.ready) return "loading";
  if (!state.user) return "signed_out";
  if (!state.profileReady) return "loading";
  if (state.profileError) return "profile_error";
  if (!profileIsComplete(state.profile)) return "complete_profile";
  if (!phoneIsVerified(state.profile)) return "verify_phone";
  return "ready";
}

const PROFILE_COLUMNS =
  "id,email,first_name,last_name,name,phone,phone_country,phone_verified_at";
const PROFILE_LOAD_ERROR = "Your account details could not be loaded. Please refresh and try again.";

/** Reads the signed-in user's profile, creating the row first if it is missing. */
export async function fetchOwnProfile(userId: string): Promise<CustomerProfile> {
  const first = await supabase
    .from("profiles")
    .select(PROFILE_COLUMNS)
    .eq("id", userId)
    .maybeSingle();
  if (first.error) throw first.error;
  const existing = normalizeProfile(first.data);
  if (existing) return existing;
  const ensured = await supabase.rpc("ensure_my_profile");
  if (ensured.error) throw ensured.error;
  const second = await supabase.from("profiles").select(PROFILE_COLUMNS).eq("id", userId).maybeSingle();
  if (second.error) throw second.error;
  const created = normalizeProfile(second.data);
  if (!created) throw new Error("The profile could not be created.");
  return created;
}

type Auth = {
  user: User | null;
  ready: boolean;
  profile: CustomerProfile | null;
  /** True once the profile for the current user has loaded (or failed to load). */
  profileReady: boolean;
  /** Set when the profile could not be loaded; pages show it instead of redirecting. */
  profileError: string | null;
  /** Name and mobile number are filled in. */
  profileComplete: boolean;
  /** The mobile number on the profile was confirmed by SMS (server-side flag). */
  phoneVerified: boolean;
  step: AccountStep;
  refreshProfile: () => Promise<CustomerProfile | null>;
  signOut: () => Promise<void>;
};
const AuthContext = createContext<Auth | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);
  const [profile, setProfile] = useState<CustomerProfile | null>(null);
  const [profileUserId, setProfileUserId] = useState<string | null>(null);
  const [profileError, setProfileError] = useState<string | null>(null);
  // Only the newest profile request may update state, and nothing updates after unmount.
  const latestRequest = useRef(0);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    let active = true;
    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      if (!active) return;
      setUser(session?.user ?? null);
      setReady(true);
      if (event !== "SIGNED_IN" && event !== "SIGNED_OUT" && event !== "USER_UPDATED") return;
      router.invalidate();
      if (event !== "SIGNED_OUT") queryClient.invalidateQueries();
    });
    supabase.auth
      .getUser()
      .then(({ data: d, error }) => {
        if (!active) return;
        // A network failure says nothing about the session; keep what onAuthStateChange reported.
        if (!isAuthRetryableFetchError(error)) setUser(d.user);
        setReady(true);
      })
      .catch(() => {
        if (active) setReady(true);
      });
    return () => {
      active = false;
      data.subscription.unsubscribe();
    };
  }, [router, queryClient]);

  const userId = user?.id ?? null;
  const loadProfile = useCallback(async (id: string | null) => {
    const request = ++latestRequest.current;
    const current = () => mounted.current && request === latestRequest.current;
    if (!id) {
      setProfile(null);
      setProfileError(null);
      setProfileUserId(null);
      return null;
    }
    try {
      const row = await fetchOwnProfile(id);
      if (!current()) return row;
      setProfile(row);
      setProfileError(null);
      setProfileUserId(id);
      return row;
    } catch (error) {
      if (!current()) return null;
      console.error("[auth] Could not load the customer profile:", error);
      setProfile(null);
      setProfileError(PROFILE_LOAD_ERROR);
      setProfileUserId(id);
      return null;
    }
  }, []);
  useEffect(() => {
    void loadProfile(userId);
  }, [userId, loadProfile]);

  const signOut = async () => {
    await queryClient.cancelQueries();
    queryClient.clear();
    const { error } = await supabase.auth.signOut();
    // A network failure still ends the session on this device.
    if (error) await supabase.auth.signOut({ scope: "local" });
    router.navigate({ to: "/login", replace: true });
  };
  const profileReady = !userId || profileUserId === userId;
  const visibleProfile = profileReady ? profile : null;
  const visibleError = profileReady ? profileError : null;
  return (
    <AuthContext.Provider
      value={{
        user,
        ready,
        profile: visibleProfile,
        profileReady,
        profileError: visibleError,
        profileComplete: profileReady && profileIsComplete(visibleProfile),
        phoneVerified: profileReady && phoneIsVerified(visibleProfile),
        step: accountStep({
          ready,
          user,
          profileReady,
          profileError: visibleError,
          profile: visibleProfile,
        }),
        refreshProfile: () => loadProfile(userId),
        signOut,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const c = useContext(AuthContext);
  if (!c) throw new Error("AuthProvider missing");
  return c;
}

/** The page a signed-in customer must visit before `returnTo`, or null when nothing is missing. */
export function requiredAccountPage(step: AccountStep) {
  if (step === "complete_profile") return "/complete-profile" as const;
  if (step === "verify_phone") return "/verify-phone" as const;
  return null;
}

/**
 * Sends signed-in customers whose profile lacks a name or phone (for example a first
 * Google/Apple sign-in) to /complete-profile, and customers whose mobile number is not
 * confirmed by SMS yet to /verify-phone, then back to `returnTo`.
 * Returns true while the page should hold back its content.
 */
export function useCompleteProfileGate(returnTo: string) {
  const { step } = useAuth();
  const navigate = useNavigate();
  const target = requiredAccountPage(step);
  useEffect(() => {
    if (target) navigate({ to: target, search: { next: returnTo }, replace: true });
  }, [target, navigate, returnTo]);
  return target !== null;
}

/** Only allow same-origin relative paths as post-auth destinations. */
export function safeNext(value: unknown) {
  return typeof value === "string" &&
    value.startsWith("/") &&
    !value.startsWith("//") &&
    !value.includes("\\") &&
    ![...value].some((ch) => ch.charCodeAt(0) < 32)
    ? value
    : "/account";
}

/** Lists every unmet signup password rule. The password itself is never trimmed or changed. */
export function passwordProblem(pw: string) {
  const missing: string[] = [];
  if (pw.length < 8) missing.push(`at least 8 characters (currently ${pw.length})`);
  if (!/[a-z]/i.test(pw)) missing.push("at least one letter (A–Z)");
  if (!/\d/.test(pw)) missing.push("at least one number (0–9)");
  if (!missing.length) return null;
  const last = missing.pop();
  return `Password needs ${missing.length ? `${missing.join(", ")} and ${last}` : last}`;
}

const emailFormat = z.string().email();

/** Basic email syntax only. It cannot confirm the mailbox exists or detect disposable providers. */
export function emailProblem(value: string) {
  const email = value.trim();
  if (!email) return "Email is required";
  if (email.length > 255 || !emailFormat.safeParse(email).success)
    return "Enter a valid email address";
  return null;
}

// Letters and combining marks from any script (Bengali vowel signs are marks), spaces,
// hyphens, straight/curly apostrophes, full stops, and the zero-width joiners used in Indic text.
const namePattern = /^[\p{L}\p{M}\p{Zs}'’.\-‌‍]+$/u;

export function nameProblem(value: string, label: "First name" | "Last name") {
  const name = value.trim();
  if (!name) return `${label} is required`;
  // Same limit as the database (public.is_valid_person_name).
  if ([...name].length > 100) return `${label} must be 100 characters or fewer`;
  if (!/\p{L}/u.test(name) || !namePattern.test(name))
    return `Enter a valid ${label.toLowerCase()} using letters, spaces, hyphens or apostrophes`;
  return null;
}

/** Field name -> message, containing only the fields that have a problem. */
export type FieldErrors<K extends string> = Partial<Record<K, string>>;

function collectErrors<K extends string>(checks: Record<K, string | null>): FieldErrors<K> {
  const errors: FieldErrors<K> = {};
  for (const key of Object.keys(checks) as K[]) {
    const message = checks[key];
    if (message) errors[key] = message;
  }
  return errors;
}

export type LoginField = "email" | "password";

/** Login only checks presence and email syntax; password strength rules apply at signup, not login. */
export function loginErrors(email: string, password: string): FieldErrors<LoginField> {
  return collectErrors<LoginField>({
    email: emailProblem(email),
    password: password.trim() ? null : "Password is required",
  });
}

export type SignupField = "first" | "last" | "mobile" | "email" | "password";
export type SignupFields = Record<SignupField | "country", string>;

/** Every signup problem at once, in on-screen field order. Empty object when the form is valid. */
export function signupErrors(f: SignupFields): FieldErrors<SignupField> {
  return collectErrors<SignupField>({
    first: nameProblem(f.first, "First name"),
    last: nameProblem(f.last, "Last name"),
    mobile: !f.mobile.trim()
      ? "Mobile number is required"
      : normalizePhone(f.country, f.mobile)
        ? null
        : "Enter a valid mobile number for the selected country",
    email: emailProblem(f.email),
    password: f.password.trim() ? passwordProblem(f.password) : "Password is required",
  });
}

/**
 * A user-safe description of a failed Supabase Auth request. `field` places the message under a
 * form field instead of in a toast; `unconfirmed` means the login needs email verification first.
 * Raw server messages are never passed through, so no internal details reach the page.
 */
export type AuthFailure = {
  message: string;
  field?: "first" | "last" | "mobile" | "email" | "password";
  unconfirmed?: true;
};

/**
 * Messages returned by the database sign-up hook (public.hook_before_user_created).
 * They are our own friendly text, so they can be shown as-is under the right field.
 * Keep in sync with supabase/migrations/20261028090100_signup_guard.sql.
 */
export const signupHookMessages = [
  {
    field: "email",
    message:
      "Please use a permanent email address. Temporary or disposable email services aren't accepted.",
  },
  { field: "first", message: "Please enter your first and last name." },
  { field: "mobile", message: "Please enter a valid mobile number for the selected country." },
] as const;

const NETWORK_MESSAGE = "We couldn't connect. Check your internet connection and try again.";
const SERVER_MESSAGE = "Our account service is having trouble. Please try again in a few minutes.";
const serverSideCodes = [
  "unexpected_failure",
  "request_timeout",
  "hook_timeout",
  "hook_timeout_after_retry",
];
const rateLimitCodes = [
  "over_request_rate_limit",
  "over_email_send_rate_limit",
  "over_sms_send_rate_limit",
];

/** Failures that read the same for login and signup: offline, server outage, or no clear signal. */
function connectionFailure(error: unknown): AuthFailure | null {
  if (typeof navigator !== "undefined" && navigator.onLine === false)
    return { message: NETWORK_MESSAGE };
  // auth-js reports "request never got a response" as status 0 and 5xx outages as their status.
  if (isAuthRetryableFetchError(error))
    return { message: error.status ? SERVER_MESSAGE : NETWORK_MESSAGE };
  if (isAuthError(error) && error.code && serverSideCodes.includes(error.code))
    return { message: SERVER_MESSAGE };
  return null;
}

const isRateLimited = (error: unknown) =>
  isAuthError(error) &&
  (error.status === 429 || (!!error.code && rateLimitCodes.includes(error.code)));

export function loginFailure(error: unknown): AuthFailure {
  const connection = connectionFailure(error);
  if (connection) return connection;
  if (isRateLimited(error))
    return { message: "Too many login attempts. Please wait a few minutes and try again." };
  if (isAuthApiError(error)) {
    // Same wording for "no such account" and "wrong password", so nobody can probe which emails exist.
    if (error.code === "invalid_credentials") return { message: "Email or password is incorrect" };
    if (error.code === "email_not_confirmed")
      return { message: "Please verify your email first", unconfirmed: true };
    if (error.code === "email_provider_disabled")
      return { message: "Email login is unavailable right now. Please try again later." };
  }
  return { message: "We couldn't log you in. Please try again." };
}

export function signupFailure(error: unknown): AuthFailure {
  const connection = connectionFailure(error);
  if (connection) return connection;
  if (isAuthError(error) && error.code === "over_email_send_rate_limit")
    return {
      message: "We've sent too many emails recently. Please wait a few minutes and try again.",
    };
  if (isRateLimited(error))
    return { message: "Too many sign-up attempts. Please wait a few minutes and try again." };
  if (isAuthWeakPasswordError(error)) {
    const reasons: string[] = error.reasons;
    if (reasons.includes("pwned"))
      return {
        field: "password",
        message:
          "This password has appeared in a known data breach. Please choose a different one.",
      };
    if (reasons.includes("length"))
      return {
        field: "password",
        message: "This password is too short. Please choose a longer one.",
      };
    return {
      field: "password",
      message:
        "Please choose a stronger password, for example by adding upper-case letters, numbers or symbols.",
    };
  }
  if (isAuthApiError(error) && error.status >= 400 && error.status < 500) {
    const fromHook = signupHookMessages.find((m) => error.message.includes(m.message));
    if (fromHook) return { field: fromHook.field, message: fromHook.message };
  }
  if (isAuthApiError(error)) {
    switch (error.code) {
      // Neutral on purpose: never confirm that an account already exists for this email.
      case "user_already_exists":
      case "email_exists":
        return {
          message:
            "We couldn't create an account with these details. If you already have an account, log in or reset your password.",
        };
      case "email_address_invalid":
        return {
          field: "email",
          message: "This email address can't be used. Please try a different one.",
        };
      case "email_address_not_authorized":
        return {
          message:
            "We can't send a verification email to this address right now. Please try another email address.",
        };
      case "signup_disabled":
      case "email_provider_disabled":
        return { message: "New accounts can't be created right now. Please try again later." };
      case "validation_failed":
        return { message: "Please check your details and try again." };
    }
  }
  return { message: "We couldn't create your account. Please try again." };
}

/** Entering the 6-digit email code on the Verify page. */
export function otpFailure(error: unknown): AuthFailure {
  const connection = connectionFailure(error);
  if (connection) return connection;
  if (isRateLimited(error))
    return { message: "Too many attempts. Please wait a few minutes and try again." };
  // Supabase uses otp_expired for both wrong and expired codes.
  if (isAuthApiError(error) && (error.code === "otp_expired" || error.status === 403))
    return { message: "That code is invalid or has expired. Request a new one and try again." };
  return { message: "We couldn't verify that code. Please try again." };
}

/** "Resend code" on the Verify page. */
export function resendFailure(error: unknown): AuthFailure {
  const connection = connectionFailure(error);
  if (connection) return connection;
  if (isRateLimited(error))
    return { message: "Please wait a minute before requesting another email." };
  if (isAuthApiError(error) && error.code === "email_address_not_authorized")
    return {
      message:
        "We can't send a verification email to this address right now. Please contact support.",
    };
  return { message: "We couldn't send a new email right now. Please try again." };
}

/**
 * "Forgot password". Returns null when the neutral "if an account exists…"
 * confirmation should be shown, so nobody can learn which emails are registered.
 */
export function resetRequestFailure(error: unknown): AuthFailure | null {
  const connection = connectionFailure(error);
  if (connection) return connection;
  if (isRateLimited(error))
    return { message: "Please wait a minute before requesting another reset email." };
  return null;
}

/** Choosing a new password from a reset link. */
export function passwordUpdateFailure(error: unknown): AuthFailure {
  const connection = connectionFailure(error);
  if (connection) return connection;
  if (isRateLimited(error))
    return { message: "Too many attempts. Please wait a few minutes and try again." };
  if (isAuthWeakPasswordError(error)) {
    const weak = signupFailure(error);
    return { field: "password", message: weak.message };
  }
  if (isAuthApiError(error) && error.code === "same_password")
    return {
      field: "password",
      message: "Choose a password that is different from your current one.",
    };
  if (
    isAuthSessionMissingError(error) ||
    (isAuthApiError(error) && (error.status === 401 || error.status === 403))
  )
    return { message: "This reset link is invalid or has expired. Please request a new one." };
  return { message: "We couldn't update your password. Please try again." };
}

/** Google/Apple sign-in errors, including errors returned to /login in the URL. */
export function oauthFailure(error: unknown): AuthFailure {
  return (
    connectionFailure(error) ?? {
      message: "We couldn't sign you in with that provider. Please try again or use email.",
    }
  );
}

/** An error Supabase added to the address (query or #hash) after an email link or Google/Apple sign-in. */
export type AuthLinkError = { error: string; code: string; description: string };

export function readAuthLinkError(href: string): AuthLinkError | null {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return null;
  }
  const hash = new URLSearchParams(url.hash.slice(1));
  const pick = (key: string) => url.searchParams.get(key) ?? hash.get(key) ?? "";
  const error = pick("error");
  const code = pick("error_code");
  if (!error && !code) return null;
  return { error, code, description: pick("error_description").slice(0, 300) };
}

/** Removes Supabase's error parameters from the address bar (no reload, no history entry). */
export function clearAuthLinkError() {
  const url = new URL(window.location.href);
  for (const key of ["error", "error_code", "error_description"]) url.searchParams.delete(key);
  const hash = new URLSearchParams(url.hash.slice(1));
  const hadHashError = hash.has("error") || hash.has("error_code");
  window.history.replaceState(
    window.history.state,
    "",
    `${url.pathname}${url.search}${hadHashError ? "" : url.hash}`,
  );
}

/**
 * Friendly text for a failed email link. Supabase's own description is never shown;
 * it is only used to recognise expired/used links.
 */
export function emailLinkFailure(link: AuthLinkError, purpose: "verify" | "reset") {
  const expired =
    link.code === "otp_expired" ||
    link.error === "access_denied" ||
    /expired|invalid/i.test(link.description);
  if (purpose === "reset")
    return expired
      ? "This password reset link is invalid or has expired. Please request a new one."
      : "We couldn't open this password reset link. Please request a new one.";
  return expired
    ? "This verification link is invalid or has expired. Enter the 6-digit code from the email, or request a new one."
    : "We couldn't verify your email with this link. Enter the 6-digit code from the email, or request a new one.";
}

export type OAuthProvider = "google" | "apple";
export const oauthProviderNames: Record<OAuthProvider, string> = { google: "Google", apple: "Apple" };

/**
 * Asks Supabase (public /auth/v1/settings) whether a sign-in provider is switched on, so a
 * customer is not sent to Supabase's raw "provider is not enabled" error page.
 * "unknown" (e.g. the check itself failed) lets the sign-in continue as before.
 */
export async function oauthProviderStatus(
  provider: OAuthProvider,
  options: { url?: string; key?: string; fetchImpl?: typeof fetch } = {},
): Promise<"enabled" | "disabled" | "unknown"> {
  const base = (options.url ?? import.meta.env["VITE_SUPABASE_URL"] ?? "").replace(/\/+$/, "");
  const key = options.key ?? import.meta.env["VITE_SUPABASE_PUBLISHABLE_KEY"] ?? "";
  if (!base || !key) return "unknown";
  try {
    const response = await (options.fetchImpl ?? fetch)(`${base}/auth/v1/settings`, {
      headers: { apikey: key },
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) return "unknown";
    const body = (await response.json()) as { external?: Record<string, unknown> } | null;
    const enabled = body?.external?.[provider];
    return enabled === true ? "enabled" : enabled === false ? "disabled" : "unknown";
  } catch {
    return "unknown";
  }
}
