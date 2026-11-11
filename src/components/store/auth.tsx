import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  ArrowLeft,
  ArrowRight,
  Eye,
  EyeOff,
  Heart,
  Lock,
  Mail,
  Package,
  ShieldCheck,
  Tag,
  Truck,
  UserRound,
  Zap,
  Smartphone,
  ChevronDown,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";
import { supabase } from "@/integrations/supabase/client";
import {
  clearAuthLinkError,
  emailLinkFailure,
  emailProblem,
  loginErrors,
  loginFailure,
  nameProblem,
  oauthFailure,
  oauthProviderNames,
  oauthProviderStatus,
  otpFailure,
  passwordProblem,
  passwordUpdateFailure,
  readAuthLinkError,
  requiredAccountPage,
  resendFailure,
  resetRequestFailure,
  safeNext,
  signupErrors,
  signupFailure,
  signupHookMessages,
  useAuth,
  type FieldErrors,
  type LoginField,
  type SignupField,
} from "@/lib/auth";
import { checkSignupDetails } from "@/lib/signup/functions";
import campaign from "@/assets/auth-campaign.jpg";
import { callingCountries, normalizePhone, signupDetailsSchema } from "@/lib/phone";
import { dbErrorKey, profileErrorMessage } from "@/lib/store/errors";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  confirmPhoneVerificationCode,
  getPhoneVerificationStatus,
  sendPhoneVerificationCode,
} from "@/lib/phone-verification/functions";
import {
  SMS_COUNTRY_MESSAGE,
  SMS_UNAVAILABLE_MESSAGE,
  sendOutcomeMessage,
  verifyOutcomeMessage,
} from "@/lib/phone-verification/messages";

type Perk = [ReactNode, string, string];
const memberPerks: Perk[] = [
  [<Tag key="t" />, "Exclusive Offers", "Member-only deals"],
  [<Package key="p" />, "Faster Checkout", "Save your details"],
  [<Heart key="h" />, "Wishlist", "Save your favourite items"],
  [<Truck key="r" />, "Order Tracking", "Track orders easily"],
];

function AuthLayout(props: {
  eyebrow: string;
  title: ReactNode;
  text: string;
  perks: Perk[];
  children: ReactNode;
}) {
  return (
    <section className="auth-page container">
      <div className="auth-visual">
        <img src={campaign} alt="YEARTH oversized cotton t-shirts on a garment rack" width={1024} height={1280} />
        <div className="auth-visual-copy">
          <span>{props.eyebrow}</span>
          <h2>{props.title}</h2>
          <p>{props.text}</p>
          <ul>
            {props.perks.map(([icon, t, d]) => (
              <li key={t}>
                <i>{icon}</i>
                <div>
                  <b>{t}</b>
                  <small>{d}</small>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </div>
      <div className="auth-card">{props.children}</div>
    </section>
  );
}

function Field(props: {
  id: string;
  label: string;
  icon: ReactNode;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  placeholder: string;
  autoComplete?: string;
  hint?: string;
  error?: string | undefined;
}) {
  const [show, setShow] = useState(false);
  const isPw = props.type === "password";
  const hintId = props.hint ? `${props.id}-hint` : undefined;
  const errorId = props.error ? `${props.id}-error` : undefined;
  return (
    <div className="auth-field">
      <label htmlFor={props.id}>{props.label}</label>
      <div className="auth-input">
        {props.icon}
        <input
          id={props.id}
          type={isPw && show ? "text" : (props.type ?? "text")}
          value={props.value}
          onChange={(e) => props.onChange(e.target.value)}
          placeholder={props.placeholder}
          autoComplete={props.autoComplete}
          required
          maxLength={props.type === "email" ? 255 : 100}
          aria-invalid={!!props.error}
          aria-describedby={[hintId, errorId].filter(Boolean).join(" ") || undefined}
        />
        {isPw && (
          <button type="button" aria-label={show ? "Hide password" : "Show password"} onClick={() => setShow(!show)}>
            {show ? <Eye /> : <EyeOff />}
          </button>
        )}
      </div>
      {props.hint && <small id={hintId}>{props.hint}</small>}
      {props.error && (
        <p id={errorId} className="field-error" role="alert">
          {props.error}
        </p>
      )}
    </div>
  );
}

/** Removes one field's message (returns the same object when there is nothing to clear). */
function withoutError<K extends string>(errors: FieldErrors<K>, key: K): FieldErrors<K> {
  if (!errors[key]) return errors;
  const next = { ...errors };
  delete next[key];
  return next;
}

/** Moves keyboard focus to the first invalid field, in on-screen order. */
function focusFirstError<K extends string>(errors: FieldErrors<K>, ids: Record<K, string>) {
  const key = (Object.keys(ids) as K[]).find((k) => errors[k]);
  if (key) document.getElementById(ids[key])?.focus();
}

const loginIds: Record<LoginField, string> = { email: "login-email", password: "login-password" };
const signupIds: Record<SignupField, string> = {
  first: "su-first",
  last: "su-last",
  mobile: "su-mobile",
  email: "su-email",
  password: "su-password",
};

/** Where to go after signing in; kept in this tab only. */
function rememberNext(next: string) {
  try {
    sessionStorage.setItem("yearth-auth-next", next);
  } catch {
    // Storage blocked: the default destination is used instead.
  }
}
function takeRememberedNext() {
  try {
    const stored = sessionStorage.getItem("yearth-auth-next");
    sessionStorage.removeItem("yearth-auth-next");
    return stored;
  } catch {
    return null;
  }
}

function SocialButtons({ next }: { next: string }) {
  const [pending, setPending] = useState<"google" | "apple" | null>(null);
  const go = async (provider: "google" | "apple") => {
    if (pending) return;
    setPending(provider);
    try {
      // A provider that is not switched on in Supabase would otherwise show a raw error page.
      if ((await oauthProviderStatus(provider)) === "disabled") {
        toast.error(
          `${oauthProviderNames[provider]} sign-in isn't available yet. Please log in with your email and password.`,
        );
        setPending(null);
        return;
      }
      rememberNext(next);
      // The provider returns to /login, where the session is picked up automatically.
      const { data, error } = await supabase.auth.signInWithOAuth({
        provider,
        options: { redirectTo: `${window.location.origin}/login`, skipBrowserRedirect: true },
      });
      if (error || !data?.url) {
        toast.error(oauthFailure(error).message);
        setPending(null);
        return;
      }
      window.location.assign(data.url);
    } catch (error) {
      toast.error(oauthFailure(error).message);
      setPending(null);
    }
  };
  return (
    <>
      <div className="auth-or"><span>OR</span></div>
      <Button variant="outline" size="lg" type="button" className="auth-social" disabled={!!pending} onClick={() => go("google")}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M21.6 12.2c0-.7-.1-1.4-.2-2H12v3.8h5.4a4.6 4.6 0 0 1-2 3v2.5h3.2c1.9-1.7 3-4.3 3-7.3ZM12 22c2.7 0 5-.9 6.6-2.4l-3.2-2.5c-.9.6-2 1-3.4 1-2.6 0-4.8-1.8-5.6-4.1H3.1v2.6A10 10 0 0 0 12 22ZM6.4 14a6 6 0 0 1 0-3.9V7.5H3.1a10 10 0 0 0 0 9L6.4 14ZM12 6c1.5 0 2.8.5 3.8 1.5l2.9-2.9A10 10 0 0 0 3.1 7.5L6.4 10C7.2 7.8 9.4 6 12 6Z" /></svg>
        Continue with Google
      </Button>
      <Button variant="outline" size="lg" type="button" className="auth-social" disabled={!!pending} onClick={() => go("apple")}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M16.4 12.6c0-2.6 2.1-3.8 2.2-3.9a4.8 4.8 0 0 0-3.8-2c-1.6-.2-3.1.9-3.9.9-.8 0-2-.9-3.3-.9a5 5 0 0 0-4.2 2.6c-1.8 3.1-.5 7.7 1.3 10.2.8 1.2 1.8 2.6 3.1 2.6s1.8-.8 3.3-.8 2 .8 3.3.8 2.2-1.3 3-2.5c1-1.4 1.3-2.7 1.4-2.8 0 0-2.4-1-2.4-4.2ZM13.9 5c.7-.8 1.2-2 1-3.1-1 0-2.2.7-2.9 1.5-.7.7-1.2 1.9-1.1 3 1.1.1 2.3-.6 3-1.4Z" /></svg>
        Continue with Apple
      </Button>
    </>
  );
}

function useRedirectWhenSignedIn(next: string) {
  const { user, step } = useAuth();
  const navigate = useNavigate();
  const userId = user?.id ?? null;
  // Read once per page visit: the stored destination is removed when read, and effects can re-run.
  const remembered = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    if (!userId || step === "loading" || step === "signed_out") return;
    if (remembered.current === undefined) remembered.current = takeRememberedNext();
    const stored = remembered.current;
    const target = safeNext(stored ?? next);
    let active = true;
    const go = (isAdmin: boolean) => {
      if (!active) return;
      const required = requiredAccountPage(step);
      if (isAdmin && !stored) navigate({ to: "/admin", replace: true });
      // A missing name/phone (e.g. a first Google/Apple sign-in), then SMS verification.
      else if (required) navigate({ to: required, search: { next: target }, replace: true });
      else navigate({ to: target, replace: true });
    };
    supabase.rpc("is_admin").then(
      ({ data }) => go(data === true),
      () => go(false),
    );
    return () => {
      active = false;
    };
  }, [userId, step, next, navigate]);
}

/** Shows a friendly message when Google/Apple sends the customer back with an error. */
function useOAuthReturnError() {
  useEffect(() => {
    const query = new URLSearchParams(window.location.search);
    const hash = new URLSearchParams(window.location.hash.slice(1));
    const error = query.get("error") ?? hash.get("error");
    if (!error) return;
    const description = query.get("error_description") ?? hash.get("error_description") ?? "";
    const fromHook = signupHookMessages.find((m) => description.includes(m.message));
    toast.error(
      fromHook?.message ??
        (error === "access_denied"
          ? "Sign-in was cancelled or not allowed. Please try again or use email."
          : oauthFailure(null).message),
    );
    for (const key of ["error", "error_code", "error_description"]) query.delete(key);
    const search = query.toString();
    window.history.replaceState(null, "", `${window.location.pathname}${search ? `?${search}` : ""}`);
  }, []);
}

/** Country selector + mobile number, shared by sign-up and profile completion. */
function PhoneField(props: {
  id: string;
  country: string;
  onCountryChange: (iso: string) => void;
  value: string;
  onChange: (v: string) => void;
  error?: string | undefined;
}) {
  const errorId = `${props.id}-error`;
  return (
    <div className="auth-field">
      <label htmlFor={props.id}>Mobile Number</label>
      <div className="auth-input auth-phone-input">
        <Smartphone />
        <Select value={props.country} onValueChange={props.onCountryChange}>
          <SelectTrigger className="auth-country" aria-label="Country calling code"><SelectValue /></SelectTrigger>
          <SelectContent>
            {callingCountries.map((item) => <SelectItem key={item.iso} value={item.iso}>{item.flag} {item.dial}<span className="sr-only"> {item.name}</span></SelectItem>)}
          </SelectContent>
        </Select>
        <input id={props.id} type="tel" inputMode="tel" autoComplete="tel-national" placeholder="Enter your mobile number" value={props.value} onChange={(e) => props.onChange(e.target.value)} maxLength={20} required aria-invalid={!!props.error} aria-describedby={props.error ? errorId : undefined} />
      </div>
      {props.error && (
        <p id={errorId} className="field-error" role="alert">
          {props.error}
        </p>
      )}
    </div>
  );
}

export function LoginPage({ next: rawNext }: { next?: string | undefined }) {
  const next = safeNext(rawNext);
  useRedirectWhenSignedIn(next);
  useOAuthReturnError();
  const navigate = useNavigate();
  const [email, setEmail] = useState(""),
    [password, setPassword] = useState(""),
    [busy, setBusy] = useState(false),
    [errors, setErrors] = useState<FieldErrors<LoginField>>({});
  const submitting = useRef(false);
  const edit = (key: LoginField, set: (v: string) => void) => (v: string) => {
    set(v);
    setErrors((current) => withoutError(current, key));
  };
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (submitting.current) return;
    const found = loginErrors(email, password);
    setErrors(found);
    if (Object.keys(found).length) {
      focusFirstError(found, loginIds);
      return;
    }
    submitting.current = true;
    setBusy(true);
    try {
      const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
      if (!error) {
        toast.success("Welcome back");
        return;
      }
      const failure = loginFailure(error);
      if (failure.unconfirmed) {
        toast(failure.message);
        rememberNext(next);
        navigate({ to: "/verify", search: { email: email.trim(), from: "login" } });
      } else toast.error(failure.message);
    } catch (error) {
      toast.error(loginFailure(error).message);
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  };
  return (
    <AuthLayout eyebrow="WELCOME TO" title={<>THE YEARTH<br />STORE</>} text="Premium styles for your everyday vibe." perks={memberPerks}>
      <h1>Login</h1>
      <p className="auth-sub">Access your account and continue shopping</p>
      <form onSubmit={submit} className="auth-form" noValidate>
        <Field id="login-email" label="Email Address" icon={<Mail />} type="email" value={email} onChange={edit("email", setEmail)} placeholder="you@example.com" autoComplete="email" error={errors.email} />
        <Field id="login-password" label="Password" icon={<Lock />} type="password" value={password} onChange={edit("password", setPassword)} placeholder="Enter your password" autoComplete="current-password" error={errors.password} />
        <Link to="/forgot-password" className="auth-forgot">Forgot Password?</Link>
        <Button size="lg" type="submit" disabled={busy}>{busy ? "Logging in…" : "Login"} <ArrowRight /></Button>
      </form>
      <SocialButtons next={next} />
      <p className="auth-switch">Don’t have an account? <Link to="/signup" search={{ next }}>Sign Up</Link></p>
    </AuthLayout>
  );
}

export function SignupPage({ next: rawNext }: { next?: string | undefined }) {
  const next = safeNext(rawNext);
  useRedirectWhenSignedIn(next);
  const navigate = useNavigate();
  const checkDetails = useServerFn(checkSignupDetails);
  const [first, setFirst] = useState(""),
    [last, setLast] = useState(""),
    [email, setEmail] = useState(""),
    [country, setCountry] = useState("IN"),
    [mobile, setMobile] = useState(""),
    [password, setPassword] = useState(""),
    [busy, setBusy] = useState(false),
    [errors, setErrors] = useState<FieldErrors<SignupField>>({});
  const submitting = useRef(false);
  const edit = (key: SignupField, set: (v: string) => void) => (v: string) => {
    set(v);
    setErrors((current) => withoutError(current, key));
  };
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (submitting.current) return;
    const found = signupErrors({ first, last, country, mobile, email, password });
    setErrors(found);
    if (Object.keys(found).length) {
      focusFirstError(found, signupIds);
      return;
    }
    const phone = normalizePhone(country, mobile);
    const details = signupDetailsSchema.safeParse({ first, last, email, phone });
    if (!details.success) {
      toast.error(details.error.issues[0]?.message ?? "Check your details");
      return;
    }
    submitting.current = true;
    setBusy(true);
    try {
      // Server check before any account exists: field rules, temporary email providers, SMS
      // support for the number's country, and that the store is set up for SMS sign-up
      // (OneAPI configured, Supabase "Confirm email" off). Nothing is created or sent here.
      const check = await checkDetails({
        data: { first, last, email: email.trim(), country, mobile },
      });
      if (!check.ok) {
        if (check.field) {
          const fieldErrors = { [check.field]: check.message };
          setErrors(fieldErrors);
          focusFirstError(fieldErrors, signupIds);
        } else toast.error(check.message);
        return;
      }
      const { data, error } = await supabase.auth.signUp({
        email: email.trim(),
        password,
        options: {
          // Only used if Supabase still emails a confirmation link; the sign-up check refuses that setup.
          emailRedirectTo: `${window.location.origin}/verify?email=${encodeURIComponent(email.trim())}`,
          // Copied into public.profiles by the database when the account is created.
          data: {
            name: `${first.trim()} ${last.trim()}`.trim(),
            first_name: details.data.first,
            last_name: details.data.last,
            phone: details.data.phone,
            phone_country: country,
          },
        },
      });
      if (error) {
        const failure = signupFailure(error);
        if (failure.field) {
          const fieldErrors = { [failure.field]: failure.message };
          setErrors(fieldErrors);
          focusFirstError(fieldErrors, signupIds);
        } else toast.error(failure.message);
        return;
      }
      if (!data.session) {
        // Supabase did not sign the customer in (an existing email, or "Confirm email" was switched
        // on after the check). Never treat this as verified, and never fall back to an email link.
        toast.error(
          "We couldn't finish creating your account. If you already have an account, log in; otherwise please try again later.",
        );
        return;
      }
      // Signed in: the SMS code is sent on the next page and must be confirmed before shopping.
      navigate({ to: "/verify-phone", search: { next }, replace: true });
    } catch (error) {
      toast.error(signupFailure(error).message);
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  };
  return (
    <AuthLayout eyebrow="JOIN THE COMMUNITY" title={<>THE YEARTH<br />STORE</>} text="Create an account and unlock a better shopping experience." perks={memberPerks}>
      <h1>Create Your Account</h1>
      <p className="auth-sub">Join YEARTH Store and start your shopping journey</p>
      <form onSubmit={submit} className="auth-form" noValidate>
        <div className="auth-row">
          <Field id="su-first" label="First Name" icon={<UserRound />} value={first} onChange={edit("first", setFirst)} placeholder="Enter your first name" autoComplete="given-name" error={errors.first} />
          <Field id="su-last" label="Last Name" icon={<UserRound />} value={last} onChange={edit("last", setLast)} placeholder="Enter your last name" autoComplete="family-name" error={errors.last} />
        </div>
        <PhoneField id="su-mobile" country={country} onCountryChange={edit("mobile", setCountry)} value={mobile} onChange={edit("mobile", setMobile)} error={errors.mobile} />
        <Field id="su-email" label="Email Address" icon={<Mail />} type="email" value={email} onChange={edit("email", setEmail)} placeholder="you@example.com" autoComplete="email" error={errors.email} />
        <Field id="su-password" label="Password" icon={<Lock />} type="password" value={password} onChange={edit("password", setPassword)} placeholder="Create a password" autoComplete="new-password" hint="Must be at least 8 characters with a number and a letter" error={errors.password} />
        <Button size="lg" type="submit" disabled={busy}>{busy ? "Creating…" : "Create Account"} <ArrowRight /></Button>
      </form>
      <SocialButtons next={next} />
      <p className="auth-switch">Already have an account? <Link to="/login" search={{ next }}>Login</Link></p>
    </AuthLayout>
  );
}

const verifyPerks: Perk[] = [
  [<ShieldCheck key="s" />, "Secure Verification", "Keeps your account safe"],
  [<Zap key="z" />, "Quick & Easy", "Takes just a few seconds"],
  [<Lock key="l" />, "Your Privacy", "Your data is always safe with us"],
];

/** Email verification after sign-up (6-digit code or the link in the email). Login never asks for a code. */
export function VerifyPage({ email, from }: { email?: string | undefined; from?: string | undefined }) {
  const { user } = useAuth();
  const navigate = useNavigate();
  // Coming from login, no email was just sent, so a new code can be requested straight away.
  const [code, setCode] = useState(""),
    [busy, setBusy] = useState(false),
    [wait, setWait] = useState(from === "login" ? 0 : 60),
    [codeError, setCodeError] = useState(""),
    [linkError, setLinkError] = useState("");
  const working = useRef(false);
  useEffect(() => {
    // An expired or already-used link in the email comes back here with an error in the address.
    const link = readAuthLinkError(window.location.href);
    if (!link) return;
    setLinkError(emailLinkFailure(link, "verify"));
    setWait(0);
    clearAuthLinkError();
  }, []);
  // Next: the optional mobile verification step, which continues by itself when it is not needed.
  const finish = () => {
    navigate({ to: "/verify-phone", search: { next: safeNext(takeRememberedNext()) }, replace: true });
  };
  useEffect(() => {
    if (wait <= 0) return;
    const t = setTimeout(() => setWait(wait - 1), 1000);
    return () => clearTimeout(t);
  }, [wait]);
  const verify = async (e: FormEvent) => {
    e.preventDefault();
    if (working.current || !email) return;
    if (!/^\d{6}$/.test(code)) {
      setCodeError("Enter the 6-digit code from your email");
      return;
    }
    working.current = true;
    setBusy(true);
    try {
      const { error } = await supabase.auth.verifyOtp({ email, token: code, type: "signup" });
      if (error) {
        setCodeError(otpFailure(error).message);
        return;
      }
      toast.success("Email verified — welcome to YEARTH");
      finish();
    } catch (error) {
      setCodeError(otpFailure(error).message);
    } finally {
      working.current = false;
      setBusy(false);
    }
  };
  const resend = async () => {
    if (working.current || wait > 0 || !email) return;
    working.current = true;
    setBusy(true);
    try {
      const { error } = await supabase.auth.resend({
        type: "signup",
        email,
        options: { emailRedirectTo: `${window.location.origin}/verify?email=${encodeURIComponent(email)}` },
      });
      if (error) {
        toast.error(resendFailure(error).message);
        return;
      }
      setCode("");
      setCodeError("");
      setLinkError("");
      toast.success("A new verification email is on its way");
      setWait(60);
    } catch (error) {
      toast.error(resendFailure(error).message);
    } finally {
      working.current = false;
      setBusy(false);
    }
  };
  return (
    <AuthLayout eyebrow="ALMOST THERE" title={<>VERIFY<br />YOUR EMAIL</>} text="We’ve sent a verification email to keep your account safe." perks={verifyPerks}>
      <Button variant="ghost" type="button" className="auth-back" onClick={() => navigate({ to: "/signup" })}><ArrowLeft /> Back</Button>
      <h1>Verify Your Email</h1>
      <p className="auth-sub">{user ? "Your email is verified." : "Enter the 6-digit code from your email, or open the link in it."}</p>
      {linkError && !user && <p className="auth-notice" role="alert">{linkError}</p>}
      {email ? (
        <>
          <div className="auth-target">
            <Mail />
            <b>{email}</b>
            <Link to="/signup">Edit</Link>
          </div>
          {user ? (
            <Button size="lg" onClick={finish}>Continue with verified email <ArrowRight /></Button>
          ) : (
            <form onSubmit={verify} className="auth-form" noValidate>
              <InputOTP maxLength={6} value={code} onChange={(v) => { setCode(v); setCodeError(""); }} aria-label="Verification code" aria-invalid={!!codeError} aria-describedby={codeError ? "verify-code-error" : undefined} containerClassName="auth-otp">
                <InputOTPGroup>
                  {[0, 1, 2, 3, 4, 5].map((i) => <InputOTPSlot key={i} index={i} />)}
                </InputOTPGroup>
              </InputOTP>
              {codeError && (
                <p id="verify-code-error" className="field-error" role="alert">
                  {codeError}
                </p>
              )}
              <p className="auth-resend">
                Didn’t receive it?{" "}
                <Button variant="link" type="button" onClick={resend} disabled={wait > 0 || busy}>Resend code</Button>
                {wait > 0 && ` in ${Math.floor(wait / 60)}:${String(wait % 60).padStart(2, "0")}`}
              </p>
              <Button size="lg" type="submit" disabled={busy || code.length !== 6}>{busy ? "Verifying…" : "Verify & Continue"} <ArrowRight /></Button>
            </form>
          )}
          {!user && (
            <>
              <div className="auth-or"><span>OR</span></div>
              <Button variant="outline" size="lg" asChild className="auth-social"><Link to="/login">I clicked the link — Login</Link></Button>
            </>
          )}
        </>
      ) : (
        <p className="auth-switch">{linkError ? <><Link to="/login">Log in</Link> to get a new verification code.</> : <><Link to="/signup">Create an account</Link> to receive a verification email.</>}</p>
      )}
    </AuthLayout>
  );
}

export function ForgotPasswordPage() {
  const [email, setEmail] = useState(""),
    [sent, setSent] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<string | undefined>(undefined);
  const working = useRef(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (working.current) return;
    const problem = emailProblem(email);
    setError(problem ?? undefined);
    if (problem) {
      document.getElementById("fp-email")?.focus();
      return;
    }
    working.current = true;
    setBusy(true);
    try {
      const { error: requestError } = await supabase.auth.resetPasswordForEmail(email.trim(), {
        redirectTo: `${window.location.origin}/reset-password`,
      });
      // Same confirmation whether or not the account exists; only real delivery problems are shown.
      const failure = requestError ? resetRequestFailure(requestError) : null;
      if (failure) {
        toast.error(failure.message);
        return;
      }
      setSent(true);
    } catch (requestError) {
      toast.error(resetRequestFailure(requestError)?.message ?? "We couldn't send the email. Please try again.");
    } finally {
      working.current = false;
      setBusy(false);
    }
  };
  return (
    <AuthLayout eyebrow="NO WORRIES" title={<>RESET YOUR<br />PASSWORD</>} text="We’ll email you a secure link to choose a new password." perks={memberPerks.slice(0, 2)}>
      <Link to="/login" className="auth-back"><ArrowLeft /> Back to login</Link>
      <h1>Forgot Password</h1>
      {sent ? (
        <p className="auth-sub">If an account exists for {email.trim()}, a reset link is on its way.</p>
      ) : (
        <form onSubmit={submit} className="auth-form" noValidate>
          <Field id="fp-email" label="Email Address" icon={<Mail />} type="email" value={email} onChange={(v) => { setEmail(v); setError(undefined); }} placeholder="you@example.com" autoComplete="email" error={error} />
          <Button size="lg" type="submit" disabled={busy}>{busy ? "Sending…" : "Send reset link"} <ArrowRight /></Button>
        </form>
      )}
    </AuthLayout>
  );
}

export function ResetPasswordPage() {
  const navigate = useNavigate();
  const [password, setPassword] = useState(""),
    // "checking" until we know whether this page was opened from a valid reset email link.
    [mode, setMode] = useState<"checking" | "ready" | "invalid" | "missing">("checking"),
    [linkMessage, setLinkMessage] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<string | undefined>(undefined);
  const working = useRef(false);
  // The address is read once: Supabase (and this page) clear it afterwards, and effects can run twice.
  const opened = useRef<{ link: ReturnType<typeof readAuthLinkError>; fromLink: boolean } | null>(null);
  useEffect(() => {
    let active = true;
    opened.current ??= {
      link: readAuthLinkError(window.location.href),
      fromLink: new URLSearchParams(window.location.hash.slice(1)).get("type") === "recovery",
    };
    const { link, fromLink } = opened.current;
    const { data } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY" && active) setMode("ready");
    });
    if (link) {
      setLinkMessage(emailLinkFailure(link, "reset"));
      setMode("invalid");
      clearAuthLinkError();
    } else {
      // getSession() waits until Supabase has finished reading the link.
      void supabase.auth.getSession().then(({ data: current }) => {
        if (!active) return;
        setMode((m) => (m !== "checking" ? m : fromLink ? (current.session ? "ready" : "invalid") : "missing"));
      });
    }
    return () => {
      active = false;
      data.subscription.unsubscribe();
    };
  }, []);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (working.current || mode !== "ready") return;
    const problem = password.trim() ? passwordProblem(password) : "Password is required";
    setError(problem ?? undefined);
    if (problem) {
      document.getElementById("rp-password")?.focus();
      return;
    }
    working.current = true;
    setBusy(true);
    try {
      const { error: updateError } = await supabase.auth.updateUser({ password });
      if (updateError) {
        const failure = passwordUpdateFailure(updateError);
        if (failure.field === "password") setError(failure.message);
        else toast.error(failure.message);
        return;
      }
      toast.success("Password updated");
      const { data } = await supabase.auth.getUser();
      const role = data.user ? await supabase.rpc("is_admin") : null;
      navigate({ to: role?.data === true ? "/admin" : "/account" });
    } catch (updateError) {
      toast.error(passwordUpdateFailure(updateError).message);
    } finally {
      working.current = false;
      setBusy(false);
    }
  };
  return (
    <AuthLayout eyebrow="ALMOST DONE" title={<>NEW<br />PASSWORD</>} text="Choose a strong password you haven’t used before." perks={memberPerks.slice(0, 2)}>
      <h1>Set a New Password</h1>
      {mode === "checking" && <p className="auth-sub" role="status">Checking your reset link…</p>}
      {(mode === "invalid" || mode === "missing") && (
        <>
          <p className="auth-notice" role="alert">
            {mode === "invalid"
              ? linkMessage || "This password reset link is invalid or has expired. Please request a new one."
              : "Open the link in your password reset email to choose a new password."}
          </p>
          <Button size="lg" asChild><Link to="/forgot-password">Request a new reset link <ArrowRight /></Link></Button>
        </>
      )}
      {mode === "ready" && (
        <form onSubmit={submit} className="auth-form" noValidate>
          <Field id="rp-password" label="New Password" icon={<Lock />} type="password" value={password} onChange={(v) => { setPassword(v); setError(undefined); }} placeholder="Create a password" autoComplete="new-password" hint="Must be at least 8 characters with a number and a letter" error={error} />
          <Button size="lg" type="submit" disabled={busy}>{busy ? "Updating…" : "Update password"} <ArrowRight /></Button>
        </form>
      )}
    </AuthLayout>
  );
}

type ProfileField = "first" | "last" | "mobile";
const profileIds: Record<ProfileField, string> = { first: "cp-first", last: "cp-last", mobile: "cp-mobile" };

/**
 * Asks for any missing name or mobile number, e.g. after a first Google/Apple
 * sign-in. Saved through public.save_my_profile, which validates it again.
 * With `edit`, a complete profile can still be changed (e.g. "change number" on the SMS step).
 */
export function CompleteProfilePage({
  next: rawNext,
  edit: editing = false,
}: {
  next?: string | undefined;
  edit?: boolean | undefined;
}) {
  const next = safeNext(rawNext);
  const { user, ready, profile, profileReady, profileError, profileComplete, refreshProfile, signOut } = useAuth();
  const navigate = useNavigate();
  const [first, setFirst] = useState(""),
    [last, setLast] = useState(""),
    [country, setCountry] = useState("IN"),
    [mobile, setMobile] = useState(""),
    [busy, setBusy] = useState(false),
    [errors, setErrors] = useState<FieldErrors<ProfileField>>({}),
    [prefilled, setPrefilled] = useState(false);
  const working = useRef(false);

  useEffect(() => {
    if (ready && !user) navigate({ to: "/login", search: { next }, replace: true });
  }, [ready, user, next, navigate]);
  useEffect(() => {
    if (prefilled || !profile) return;
    setFirst(profile.first_name);
    setLast(profile.last_name);
    const known = callingCountries.find((c) => c.iso === profile.phone_country);
    if (known) {
      setCountry(known.iso);
      if (profile.phone.startsWith(known.dial)) setMobile(profile.phone.slice(known.dial.length));
    }
    setPrefilled(true);
  }, [profile, prefilled]);
  useEffect(() => {
    // Nothing missing (e.g. opened directly): continue, through the SMS step if needed.
    if (!editing && profileReady && profileComplete && !working.current)
      navigate({ to: "/verify-phone", search: { next }, replace: true });
  }, [editing, profileReady, profileComplete, next, navigate]);

  const edit = (key: ProfileField, set: (v: string) => void) => (v: string) => {
    set(v);
    setErrors((current) => withoutError(current, key));
  };
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (working.current) return;
    const phone = mobile.trim() ? normalizePhone(country, mobile) : null;
    const found: FieldErrors<ProfileField> = {};
    const firstProblem = nameProblem(first, "First name");
    const lastProblem = nameProblem(last, "Last name");
    if (firstProblem) found.first = firstProblem;
    if (lastProblem) found.last = lastProblem;
    if (!mobile.trim()) found.mobile = "Mobile number is required";
    else if (!phone) found.mobile = "Enter a valid mobile number for the selected country";
    setErrors(found);
    if (Object.keys(found).length || !phone) {
      focusFirstError(found, profileIds);
      return;
    }
    working.current = true;
    setBusy(true);
    try {
      const { error } = await supabase.rpc("save_my_profile", {
        p_first_name: first.trim(),
        p_last_name: last.trim(),
        p_phone: phone,
        p_phone_country: country,
      });
      if (error) {
        const message = profileErrorMessage(error);
        const key = dbErrorKey(error);
        const field: ProfileField | null =
          key === "INVALID_FIRST_NAME" ? "first" : key === "INVALID_LAST_NAME" ? "last" : key === "INVALID_PHONE" ? "mobile" : null;
        if (field) {
          const fieldErrors = { [field]: message };
          setErrors(fieldErrors);
          focusFirstError(fieldErrors, profileIds);
        } else toast.error(message);
        return;
      }
      await refreshProfile();
      toast.success("Thanks! Your details are saved.");
      navigate({ to: "/verify-phone", search: { next }, replace: true });
    } catch (error) {
      toast.error(profileErrorMessage(error));
    } finally {
      working.current = false;
      setBusy(false);
    }
  };
  return (
    <AuthLayout eyebrow="ONE LAST STEP" title={<>COMPLETE<br />YOUR PROFILE</>} text="Add your name and mobile number for orders and delivery updates." perks={memberPerks.slice(0, 2)}>
      <h1>Complete Your Profile</h1>
      <p className="auth-sub">{user?.email ? `Signed in as ${user.email}` : "We need a few details before you continue."}</p>
      {profileError ? (
        <p className="auth-notice" role="alert">{profileError}</p>
      ) : (
        <form onSubmit={submit} className="auth-form" noValidate>
          <div className="auth-row">
            <Field id="cp-first" label="First Name" icon={<UserRound />} value={first} onChange={edit("first", setFirst)} placeholder="Enter your first name" autoComplete="given-name" error={errors.first} />
            <Field id="cp-last" label="Last Name" icon={<UserRound />} value={last} onChange={edit("last", setLast)} placeholder="Enter your last name" autoComplete="family-name" error={errors.last} />
          </div>
          <PhoneField id="cp-mobile" country={country} onCountryChange={edit("mobile", setCountry)} value={mobile} onChange={edit("mobile", setMobile)} error={errors.mobile} />
          <Button size="lg" type="submit" disabled={busy || !profileReady}>{busy ? "Saving…" : "Save & Continue"} <ArrowRight /></Button>
        </form>
      )}
      <p className="auth-switch">Not you? <Button variant="link" type="button" onClick={() => void signOut()}>Sign out</Button></p>
    </AuthLayout>
  );
}

const phonePerks: Perk[] = [
  [<ShieldCheck key="s" />, "Account Security", "Confirms this number is yours"],
  [<Truck key="t" />, "Delivery Updates", "Couriers can reach you"],
  [<Lock key="l" />, "Your Privacy", "Used only for your orders"],
];

/**
 * Required SMS verification of the mobile number saved on the profile (sign-up step, and for
 * any signed-in customer whose number is not verified yet). The server decides which number
 * receives the code (always the profile's own), generates and checks the code, and enforces
 * every limit; this page only displays it. It never lets the customer continue unverified:
 * when SMS is not configured or the number's country is not supported it says so instead.
 */
export function VerifyPhonePage({ next: rawNext }: { next?: string | undefined }) {
  const next = safeNext(rawNext);
  const { user, ready, profile, refreshProfile, signOut } = useAuth();
  const navigate = useNavigate();
  const fetchStatus = useServerFn(getPhoneVerificationStatus);
  const requestCode = useServerFn(sendPhoneVerificationCode);
  const checkCode = useServerFn(confirmPhoneVerificationCode);
  const queryClient = useQueryClient();
  const status = useQuery({
    queryKey: ["phone-verification", user?.id, profile?.phone],
    queryFn: () => fetchStatus(),
    enabled: ready && !!user,
    retry: false,
  });
  const [code, setCode] = useState(""),
    [codeSent, setCodeSent] = useState(false),
    [busy, setBusy] = useState(false),
    [wait, setWait] = useState(0),
    [notice, setNotice] = useState(""),
    [codeError, setCodeError] = useState("");
  const working = useRef(false);
  const autoSent = useRef(false);
  const leaving = useRef(false);
  const s = status.data;
  const canSend = !!s && s.enabled && s.hasPhone && s.supported && !s.verified;

  useEffect(() => {
    if (!ready || user) return;
    // Right after sign-up the session can arrive a moment later; only leave if there is none.
    let active = true;
    void supabase.auth.getSession().then(({ data }) => {
      if (active && !data.session) navigate({ to: "/login", search: { next: `/verify-phone?next=${encodeURIComponent(next)}` }, replace: true });
    });
    return () => {
      active = false;
    };
  }, [ready, user, next, navigate]);
  // Already verified: refresh the profile (so the account pages see it), then continue.
  useEffect(() => {
    if (!s?.verified || leaving.current) return;
    leaving.current = true;
    let active = true;
    void refreshProfile().then(() => {
      if (active) navigate({ to: next, replace: true });
    });
    return () => {
      active = false;
    };
  }, [s?.verified, refreshProfile, next, navigate]);
  // No number on the profile yet: add one first, then come back here.
  useEffect(() => {
    if (s && !s.verified && !s.hasPhone)
      navigate({ to: "/complete-profile", search: { next, edit: true }, replace: true });
  }, [s, next, navigate]);
  useEffect(() => {
    if (!s) return;
    setWait(s.resendIn);
    if (s.codeActive) setCodeSent(true);
  }, [s]);
  useEffect(() => {
    if (wait <= 0) return;
    const t = setTimeout(() => setWait(wait - 1), 1000);
    return () => clearTimeout(t);
  }, [wait]);

  const send = async () => {
    if (working.current) return;
    working.current = true;
    setBusy(true);
    setCodeError("");
    try {
      const result = await requestCode();
      setNotice(sendOutcomeMessage(result));
      if (result.status === "sent") {
        setCodeSent(true);
        setCode("");
        setWait(result.resendIn);
      } else if (result.status === "cooldown") setWait(result.resendIn);
      else if (result.status === "already_verified") {
        await queryClient.invalidateQueries({ queryKey: ["phone-verification"] });
      }
    } catch (error) {
      setNotice("");
      setCodeError(error instanceof Error ? error.message : "We couldn't send the code. Please try again.");
    } finally {
      working.current = false;
      setBusy(false);
    }
  };
  // The code is sent once automatically when the page opens and no code is outstanding.
  useEffect(() => {
    if (!s || autoSent.current || !canSend || s.codeActive || s.resendIn > 0) return;
    autoSent.current = true;
    void send();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- send() is guarded by refs and the server's cooldown.
  }, [s, canSend]);

  const verify = async (e: FormEvent) => {
    e.preventDefault();
    if (working.current) return;
    if (!/^\d{6}$/.test(code)) {
      setCodeError("Enter the 6-digit code from the SMS");
      return;
    }
    working.current = true;
    setBusy(true);
    try {
      const result = await checkCode({ data: { code } });
      const problem = verifyOutcomeMessage(result);
      if (problem) {
        setCodeError(problem);
        if (result.status !== "incorrect") setCodeSent(false);
        return;
      }
      leaving.current = true;
      await queryClient.invalidateQueries({ queryKey: ["phone-verification"] });
      await refreshProfile();
      toast.success("Mobile number verified");
      navigate({ to: next, replace: true });
    } catch (error) {
      setCodeError(error instanceof Error ? error.message : "We couldn't check the code. Please try again.");
    } finally {
      working.current = false;
      setBusy(false);
    }
  };

  const changeNumber = (
    <Link to="/complete-profile" search={{ next, edit: true }}>
      Edit
    </Link>
  );
  const signOutLine = (
    <p className="auth-switch">
      Not you?{" "}
      <Button variant="link" type="button" onClick={() => void signOut()}>
        Sign out
      </Button>
    </p>
  );
  return (
    <AuthLayout eyebrow="ONE MORE STEP" title={<>VERIFY YOUR<br />MOBILE</>} text="Confirm your mobile number so we can reach you about your orders." perks={phonePerks}>
      <h1>Verify Your Mobile Number</h1>
      {status.isError ? (
        <>
          <p className="auth-notice" role="alert">{status.error instanceof Error ? status.error.message : "Mobile verification isn't available right now."}</p>
          <Button size="lg" onClick={() => void status.refetch()}>
            Try again <ArrowRight />
          </Button>
          {signOutLine}
        </>
      ) : !s || s.verified || !s.hasPhone ? (
        <p className="auth-sub" role="status">Loading…</p>
      ) : !s.enabled ? (
        <>
          <p className="auth-notice" role="alert">
            {SMS_UNAVAILABLE_MESSAGE}
          </p>
          {signOutLine}
        </>
      ) : !s.supported ? (
        <>
          <p className="auth-notice" role="alert">
            {SMS_COUNTRY_MESSAGE} Please change your number to continue.
          </p>
          <div className="auth-target">
            <Smartphone />
            <b>{s.phoneMasked}</b>
            {changeNumber}
          </div>
          {signOutLine}
        </>
      ) : (
        <>
          <p className="auth-sub">{codeSent ? "Enter the 6-digit code we sent by SMS." : "We’ll send a 6-digit code by SMS to your mobile number."}</p>
          <div className="auth-target">
            <Smartphone />
            <b>{s.phoneMasked}</b>
            {changeNumber}
          </div>
          {notice && <p className="auth-sub" role="status">{notice}</p>}
          {codeSent ? (
            <form onSubmit={verify} className="auth-form" noValidate>
              <InputOTP maxLength={6} value={code} onChange={(v) => { setCode(v); setCodeError(""); }} aria-label="SMS verification code" aria-invalid={!!codeError} aria-describedby={codeError ? "phone-code-error" : undefined} containerClassName="auth-otp">
                <InputOTPGroup>
                  {[0, 1, 2, 3, 4, 5].map((i) => <InputOTPSlot key={i} index={i} />)}
                </InputOTPGroup>
              </InputOTP>
              {codeError && (
                <p id="phone-code-error" className="field-error" role="alert">
                  {codeError}
                </p>
              )}
              <p className="auth-resend">
                Didn’t receive it?{" "}
                <Button variant="link" type="button" onClick={() => void send()} disabled={wait > 0 || busy}>Resend code</Button>
                {wait > 0 && ` in ${Math.floor(wait / 60)}:${String(wait % 60).padStart(2, "0")}`}
              </p>
              <Button size="lg" type="submit" disabled={busy || code.length !== 6}>{busy ? "Verifying…" : "Verify & Continue"} <ArrowRight /></Button>
            </form>
          ) : (
            <div className="auth-form">
              {codeError && <p className="field-error" role="alert">{codeError}</p>}
              <Button size="lg" type="button" onClick={() => void send()} disabled={busy || wait > 0}>
                {busy ? "Sending…" : wait > 0 ? `Send code in ${wait}s` : "Send code"} <ArrowRight />
              </Button>
            </div>
          )}
          {signOutLine}
        </>
      )}
    </AuthLayout>
  );
}
