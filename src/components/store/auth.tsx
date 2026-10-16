import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
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
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable";
import { passwordProblem, safeNext, useAuth } from "@/lib/auth";
import campaign from "@/assets/auth-campaign.jpg";

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
}) {
  const [show, setShow] = useState(false);
  const isPw = props.type === "password";
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
        />
        {isPw && (
          <button type="button" aria-label={show ? "Hide password" : "Show password"} onClick={() => setShow(!show)}>
            {show ? <Eye /> : <EyeOff />}
          </button>
        )}
      </div>
      {props.hint && <small>{props.hint}</small>}
    </div>
  );
}

function SocialButtons({ next }: { next: string }) {
  const go = async (provider: "google" | "apple") => {
    sessionStorage.setItem("yearth-auth-next", next);
    const r = await lovable.auth.signInWithOAuth(provider, { redirect_uri: window.location.origin + "/login" });
    if (r.error) toast.error("Couldn't sign you in. Please try again.");
  };
  return (
    <>
      <div className="auth-or"><span>OR</span></div>
      <Button variant="outline" size="lg" type="button" className="auth-social" onClick={() => go("google")}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M21.6 12.2c0-.7-.1-1.4-.2-2H12v3.8h5.4a4.6 4.6 0 0 1-2 3v2.5h3.2c1.9-1.7 3-4.3 3-7.3ZM12 22c2.7 0 5-.9 6.6-2.4l-3.2-2.5c-.9.6-2 1-3.4 1-2.6 0-4.8-1.8-5.6-4.1H3.1v2.6A10 10 0 0 0 12 22ZM6.4 14a6 6 0 0 1 0-3.9V7.5H3.1a10 10 0 0 0 0 9L6.4 14ZM12 6c1.5 0 2.8.5 3.8 1.5l2.9-2.9A10 10 0 0 0 3.1 7.5L6.4 10C7.2 7.8 9.4 6 12 6Z" /></svg>
        Continue with Google
      </Button>
      <Button variant="outline" size="lg" type="button" className="auth-social" onClick={() => go("apple")}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M16.4 12.6c0-2.6 2.1-3.8 2.2-3.9a4.8 4.8 0 0 0-3.8-2c-1.6-.2-3.1.9-3.9.9-.8 0-2-.9-3.3-.9a5 5 0 0 0-4.2 2.6c-1.8 3.1-.5 7.7 1.3 10.2.8 1.2 1.8 2.6 3.1 2.6s1.8-.8 3.3-.8 2 .8 3.3.8 2.2-1.3 3-2.5c1-1.4 1.3-2.7 1.4-2.8 0 0-2.4-1-2.4-4.2ZM13.9 5c.7-.8 1.2-2 1-3.1-1 0-2.2.7-2.9 1.5-.7.7-1.2 1.9-1.1 3 1.1.1 2.3-.6 3-1.4Z" /></svg>
        Continue with Apple
      </Button>
    </>
  );
}

function useRedirectWhenSignedIn(next: string) {
  const { user, ready } = useAuth();
  const navigate = useNavigate();
  useEffect(() => {
    if (!ready || !user) return;
    const stored = sessionStorage.getItem("yearth-auth-next");
    sessionStorage.removeItem("yearth-auth-next");
    navigate({ to: safeNext(stored ?? next), replace: true });
  }, [ready, user, next, navigate]);
}

export function LoginPage({ next: rawNext }: { next?: string }) {
  const next = safeNext(rawNext);
  useRedirectWhenSignedIn(next);
  const navigate = useNavigate();
  const [email, setEmail] = useState(""),
    [password, setPassword] = useState(""),
    [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    setBusy(false);
    if (!error) return toast.success("Welcome back");
    if (/confirm/i.test(error.message)) {
      toast("Please verify your email first");
      navigate({ to: "/verify", search: { email: email.trim() } });
    } else toast.error("Email or password is incorrect");
  };
  return (
    <AuthLayout eyebrow="WELCOME TO" title={<>THE YEARTH<br />STORE</>} text="Premium styles for your everyday vibe." perks={memberPerks}>
      <h1>Login</h1>
      <p className="auth-sub">Access your account and continue shopping</p>
      <form onSubmit={submit} className="auth-form">
        <Field id="login-email" label="Email Address" icon={<Mail />} type="email" value={email} onChange={setEmail} placeholder="you@example.com" autoComplete="email" />
        <Field id="login-password" label="Password" icon={<Lock />} type="password" value={password} onChange={setPassword} placeholder="Enter your password" autoComplete="current-password" />
        <Link to="/forgot-password" className="auth-forgot">Forgot Password?</Link>
        <Button size="lg" type="submit" disabled={busy}>{busy ? "Logging in…" : "Login"} <ArrowRight /></Button>
      </form>
      <SocialButtons next={next} />
      <p className="auth-switch">Don’t have an account? <Link to="/signup" search={{ next }}>Sign Up</Link></p>
    </AuthLayout>
  );
}

export function SignupPage({ next: rawNext }: { next?: string }) {
  const next = safeNext(rawNext);
  useRedirectWhenSignedIn(next);
  const navigate = useNavigate();
  const [first, setFirst] = useState(""),
    [last, setLast] = useState(""),
    [email, setEmail] = useState(""),
    [password, setPassword] = useState(""),
    [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const problem = passwordProblem(password);
    if (problem) return toast.error(problem);
    setBusy(true);
    const { error } = await supabase.auth.signUp({
      email: email.trim(),
      password,
      options: {
        emailRedirectTo: `${window.location.origin}/login?next=${encodeURIComponent(next)}`,
        data: { name: `${first.trim()} ${last.trim()}`.trim() },
      },
    });
    setBusy(false);
    if (error) return toast.error(error.message);
    navigate({ to: "/verify", search: { email: email.trim() } });
  };
  return (
    <AuthLayout eyebrow="JOIN THE COMMUNITY" title={<>THE YEARTH<br />STORE</>} text="Create an account and unlock a better shopping experience." perks={memberPerks}>
      <h1>Create Your Account</h1>
      <p className="auth-sub">Join YEARTH Store and start your shopping journey</p>
      <form onSubmit={submit} className="auth-form">
        <div className="auth-row">
          <Field id="su-first" label="First Name" icon={<UserRound />} value={first} onChange={setFirst} placeholder="Enter your first name" autoComplete="given-name" />
          <Field id="su-last" label="Last Name" icon={<UserRound />} value={last} onChange={setLast} placeholder="Enter your last name" autoComplete="family-name" />
        </div>
        <Field id="su-email" label="Email Address" icon={<Mail />} type="email" value={email} onChange={setEmail} placeholder="you@example.com" autoComplete="email" />
        <Field id="su-password" label="Password" icon={<Lock />} type="password" value={password} onChange={setPassword} placeholder="Create a password" autoComplete="new-password" hint="Must be at least 8 characters with a number and a letter" />
        <Button size="lg" type="submit" disabled={busy}>{busy ? "Creating…" : "Create Account"} <ArrowRight /></Button>
      </form>
      <SocialButtons next={next} />
      <p className="auth-switch">Already have an account? <Link to="/login" search={{ next }}>Login</Link></p>
    </AuthLayout>
  );
}

export function VerifyPage({ email }: { email?: string }) {
  useRedirectWhenSignedIn("/account");
  const navigate = useNavigate();
  const [code, setCode] = useState(""),
    [busy, setBusy] = useState(false),
    [wait, setWait] = useState(30);
  useEffect(() => {
    if (wait <= 0) return;
    const t = setTimeout(() => setWait(wait - 1), 1000);
    return () => clearTimeout(t);
  }, [wait]);
  const verify = async (e: FormEvent) => {
    e.preventDefault();
    if (!email || code.length !== 6) return;
    setBusy(true);
    const { error } = await supabase.auth.verifyOtp({ email, token: code, type: "signup" });
    setBusy(false);
    if (error) toast.error("That code is invalid or has expired");
    else toast.success("Email verified — welcome to YEARTH");
  };
  const resend = async () => {
    if (!email) return;
    const { error } = await supabase.auth.resend({ type: "signup", email });
    if (error) return toast.error(error.message);
    toast.success("A new verification email is on its way");
    setWait(30);
  };
  return (
    <AuthLayout
      eyebrow="ALMOST THERE"
      title={<>VERIFY<br />YOUR EMAIL</>}
      text="We’ve sent a verification email to keep your account safe."
      perks={[
        [<ShieldCheck key="s" />, "Secure Verification", "Keeps your account safe"],
        [<Zap key="z" />, "Quick & Easy", "Takes just a few seconds"],
        [<Lock key="l" />, "Your Privacy", "Your data is always safe with us"],
      ]}
    >
      <button type="button" className="auth-back" onClick={() => navigate({ to: "/signup" })}><ArrowLeft /> Back</button>
      <h1>Verify Your Email</h1>
      <p className="auth-sub">Open the link in your email, or enter the 6-digit code if it includes one.</p>
      {email ? (
        <>
          <div className="auth-target">
            <Mail />
            <b>{email}</b>
            <Link to="/signup">Edit</Link>
          </div>
          <form onSubmit={verify} className="auth-form">
            <InputOTP maxLength={6} value={code} onChange={setCode} aria-label="Verification code" containerClassName="auth-otp">
              <InputOTPGroup>
                {[0, 1, 2, 3, 4, 5].map((i) => <InputOTPSlot key={i} index={i} />)}
              </InputOTPGroup>
            </InputOTP>
            <p className="auth-resend">
              Didn’t receive it?{" "}
              <button type="button" onClick={resend} disabled={wait > 0}>Resend</button>
              {wait > 0 && ` in 00:${String(wait).padStart(2, "0")}`}
            </p>
            <Button size="lg" type="submit" disabled={busy || code.length !== 6}>{busy ? "Verifying…" : "Verify & Continue"} <ArrowRight /></Button>
          </form>
          <div className="auth-or"><span>OR</span></div>
          <Button variant="outline" size="lg" asChild className="auth-social"><Link to="/login">I clicked the link — Login</Link></Button>
        </>
      ) : (
        <p className="auth-switch"><Link to="/signup">Create an account</Link> to receive a verification email.</p>
      )}
    </AuthLayout>
  );
}

export function ForgotPasswordPage() {
  const [email, setEmail] = useState(""),
    [sent, setSent] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo: `${window.location.origin}/reset-password` });
    if (error) return toast.error(error.message);
    setSent(true);
  };
  return (
    <AuthLayout eyebrow="NO WORRIES" title={<>RESET YOUR<br />PASSWORD</>} text="We’ll email you a secure link to choose a new password." perks={memberPerks.slice(0, 2)}>
      <Link to="/login" className="auth-back"><ArrowLeft /> Back to login</Link>
      <h1>Forgot Password</h1>
      {sent ? (
        <p className="auth-sub">If an account exists for {email}, a reset link is on its way.</p>
      ) : (
        <form onSubmit={submit} className="auth-form">
          <Field id="fp-email" label="Email Address" icon={<Mail />} type="email" value={email} onChange={setEmail} placeholder="you@example.com" autoComplete="email" />
          <Button size="lg" type="submit">Send reset link <ArrowRight /></Button>
        </form>
      )}
    </AuthLayout>
  );
}

export function ResetPasswordPage() {
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const problem = passwordProblem(password);
    if (problem) return toast.error(problem);
    const { error } = await supabase.auth.updateUser({ password });
    if (error) return toast.error("This reset link is invalid or has expired");
    toast.success("Password updated");
    navigate({ to: "/account" });
  };
  return (
    <AuthLayout eyebrow="ALMOST DONE" title={<>NEW<br />PASSWORD</>} text="Choose a strong password you haven’t used before." perks={memberPerks.slice(0, 2)}>
      <h1>Set a New Password</h1>
      <form onSubmit={submit} className="auth-form">
        <Field id="rp-password" label="New Password" icon={<Lock />} type="password" value={password} onChange={setPassword} placeholder="Create a password" autoComplete="new-password" hint="Must be at least 8 characters with a number and a letter" />
        <Button size="lg" type="submit">Update password <ArrowRight /></Button>
      </form>
    </AuthLayout>
  );
}