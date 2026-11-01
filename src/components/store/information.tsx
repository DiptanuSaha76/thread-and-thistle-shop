import { useEffect, useState } from "react";
import type { FormEvent, ComponentType, ReactNode } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { getPhoneVerificationStatus } from "@/lib/phone-verification/functions";
import { submitContactMessage } from "@/lib/support/functions";
import type { Tables } from "@/integrations/supabase/types";
import { nameProblem, useAuth, useCompleteProfileGate } from "@/lib/auth";
import { parseInternationalPhone } from "@/lib/phone";
import { accountErrorMessage, profileErrorMessage } from "@/lib/store/errors";
import { toast } from "sonner";
import { ArrowRight, UserRound, Package, Heart, Headphones, MapPin, CreditCard, ShieldCheck, Settings2, LogOut, Plus, Trash2, Check, Bell, ChevronRight, LayoutDashboard, Pencil, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Breadcrumb, ProductGrid, Benefits } from "./shared";
import { useStore } from "@/lib/store/state";
import { products } from "@/lib/store/catalogue";
import campaign from "@/assets/campaign.jpg";
type SavedAddress = {
  id: string;
  label: string;
  fullName: string;
  phone: string;
  line1: string;
  line2: string;
  city: string;
  state: string;
  pincode: string;
  isDefault: boolean;
};

type SavedPayment = {
  id: string;
  holder: string;
  brand: string;
  last4: string;
  isDefault: boolean;
};

const accountTabs = [
  { id: "overview", label: "Overview", icon: LayoutDashboard },
  { id: "profile", label: "Personal profile", icon: UserRound },
  { id: "orders", label: "My orders", icon: Package },
  { id: "addresses", label: "Addresses", icon: MapPin },
  { id: "payments", label: "Payment methods", icon: CreditCard },
  { id: "wishlist", label: "Wishlist", icon: Heart },
  { id: "security", label: "Security", icon: ShieldCheck },
  { id: "preferences", label: "Preferences", icon: Settings2 },
] as const;

type AccountTab = (typeof accountTabs)[number]["id"];

type AddressRow = Pick<
  Tables<"yearth_addresses">,
  "id" | "label" | "full_name" | "phone" | "line1" | "line2" | "city" | "state" | "pincode" | "is_default"
>;
const toSavedAddress = (row: AddressRow): SavedAddress => ({
  id: row.id, label: row.label, fullName: row.full_name, phone: row.phone,
  line1: row.line1, line2: row.line2 ?? "", city: row.city, state: row.state,
  pincode: row.pincode, isDefault: Boolean(row.is_default),
});
/** Indian mobile as 10 digits (delivery addresses are within India). */
const indianDigits = (value: string) => value.replace(/\D/g, "").replace(/^(91|0)(?=[6-9]\d{9}$)/, "");
/** Same rules as the database constraint on saved addresses. */
function addressProblem(d: { label: string; fullName: string; phone: string; line1: string; line2: string; city: string; state: string; pincode: string }) {
  if (!d.fullName.trim() || !d.line1.trim() || !d.city.trim() || !d.state.trim()) return "Please fill in the name, address, city and state.";
  if (!/^[6-9]\d{9}$/.test(indianDigits(d.phone))) return "Enter a valid 10-digit Indian mobile number for this address.";
  if (!/^[1-9]\d{5}$/.test(d.pincode.trim())) return "Enter a valid 6-digit pincode.";
  if (d.line1.trim().length > 200 || d.line2.trim().length > 200 || d.city.trim().length > 80 || d.state.trim().length > 80 || d.fullName.trim().length > 120 || d.label.trim().length > 40) return "Some address details are too long.";
  return null;
}

export function AccountPage() {
  const store = useStore();
  const navigate = useNavigate();
  const { user, ready, profile, profileReady, profileError, refreshProfile, signOut: endSession } = useAuth();
  const holdForProfile = useCompleteProfileGate("/account");
  const [dataLoading, setDataLoading] = useState(true);
  const [accountError, setAccountError] = useState("");
  const [activeTab, setActiveTab] = useState<AccountTab>("overview");
  const [name, setName] = useState(store.profile || "");
  const [phone, setPhone] = useState("");
  const [addresses, setAddresses] = useState<SavedAddress[]>([]);
  const [payments, setPayments] = useState<SavedPayment[]>([]);
  const [addressFormOpen, setAddressFormOpen] = useState(false);
  const [paymentFormOpen, setPaymentFormOpen] = useState(false);
  const [editingAddress, setEditingAddress] = useState<SavedAddress | null>(null);
  const [addressDraft, setAddressDraft] = useState({ label: "Home", fullName: "", phone: "", line1: "", line2: "", city: "", state: "", pincode: "" });
  const [paymentDraft, setPaymentDraft] = useState({ holder: "", brand: "Visa", last4: "" });
  const [newsletter, setNewsletter] = useState(true);
  const [orderUpdates, setOrderUpdates] = useState(true);
  const [savingProfile, setSavingProfile] = useState(false);
  const wishlistItems = products.filter((p) => store.wishlist.includes(p.id));
  const email = user?.email ?? "";
  const userId = user?.id ?? null;

  useEffect(() => {
    if (ready && !user) window.location.replace("/login?next=%2Faccount");
  }, [ready, user]);

  // Name and phone come from public.profiles (loaded by the AuthProvider).
  useEffect(() => {
    if (!profile) return;
    const displayName = profile.name || `${profile.first_name} ${profile.last_name}`.trim();
    setName(displayName);
    setPhone(profile.phone);
    if (displayName) store.setProfile(displayName);
  }, [profile, store.setProfile]);

  useEffect(() => {
    if (!userId) return;
    let active = true;
    (async () => {
      setDataLoading(true);
      setAccountError("");
      const [addressResult, preferenceResult] = await Promise.all([
        supabase
          .from("yearth_addresses")
          .select("id, label, full_name, phone, line1, line2, city, state, pincode, is_default")
          .eq("user_id", userId)
          .order("created_at", { ascending: true }),
        supabase
          .from("yearth_account_preferences")
          .select("newsletter, order_updates")
          .eq("user_id", userId)
          .maybeSingle(),
      ]);
      if (!active) return;
      if (addressResult.error || preferenceResult.error) {
        console.error("Unable to load account data:", addressResult.error ?? preferenceResult.error);
        setAccountError("Your account data could not be loaded. Please refresh and try again.");
      }
      setAddresses((addressResult.data ?? []).map(toSavedAddress));
      setNewsletter(preferenceResult.data?.newsletter ?? true);
      setOrderUpdates(preferenceResult.data?.order_updates ?? true);
      // Payment labels deliberately remain local-only; no card data is stored.
      try {
        const savedPayments = JSON.parse(localStorage.getItem("yearth-account-payments") || "[]");
        setPayments(Array.isArray(savedPayments) ? savedPayments : []);
      } catch {
        setPayments([]);
      }
      setDataLoading(false);
    })();
    return () => {
      active = false;
    };
  }, [userId]);

  const persistProfile = async () => {
    if (!user || savingProfile) return;
    setAccountError("");
    if (!name.trim()) {
      setAccountError("Full name is required");
      return;
    }
    if (nameProblem(name, "First name")) {
      setAccountError("Enter a valid full name using letters, spaces, hyphens or apostrophes");
      return;
    }
    const parsed = parseInternationalPhone(phone, profile?.phone_country || "IN");
    if (!parsed) {
      setAccountError("Enter a valid mobile number, for example +91 98765 43210.");
      return;
    }
    setSavingProfile(true);
    try {
      const { error } = await supabase.rpc("save_my_profile", {
        p_name: name.trim(),
        p_phone: parsed.phone,
        p_phone_country: parsed.country,
      });
      if (error) {
        setAccountError(profileErrorMessage(error));
        toast.error("Profile could not be saved");
        return;
      }
      await refreshProfile();
      toast.success("Profile details saved");
    } finally {
      setSavingProfile(false);
    }
  };

  const persistAddresses = (next: SavedAddress[]) => setAddresses(next);

  const persistPayments = (next: SavedPayment[]) => {
    setPayments(next);
    localStorage.setItem("yearth-account-payments", JSON.stringify(next));
  };

  const openNewAddress = () => {
    setEditingAddress(null);
    setAddressDraft({ label: "Home", fullName: name, phone: indianDigits(phone), line1: "", line2: "", city: "", state: "", pincode: "" });
    setAddressFormOpen(true);
  };

  const saveAddress = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!user) return;
    setAccountError("");
    const problem = addressProblem(addressDraft);
    if (problem) {
      setAccountError(problem);
      return;
    }
    const isDefault = editingAddress?.isDefault ?? addresses.length === 0;
    const payload = {
      user_id: user.id, label: addressDraft.label.trim() || "Home", full_name: addressDraft.fullName.trim(),
      phone: indianDigits(addressDraft.phone), line1: addressDraft.line1.trim(), line2: addressDraft.line2.trim(),
      city: addressDraft.city.trim(), state: addressDraft.state.trim(), pincode: addressDraft.pincode.trim(),
      is_default: isDefault,
    };
    const columns = "id, label, full_name, phone, line1, line2, city, state, pincode, is_default";
    const result = editingAddress
      ? await supabase.from("yearth_addresses").update(payload).eq("id", editingAddress.id).eq("user_id", user.id).select(columns).single()
      : await supabase.from("yearth_addresses").insert(payload).select(columns).single();
    if (result.error) {
      setAccountError(accountErrorMessage(result.error, "Saving the address"));
      toast.error("Address could not be saved");
      return;
    }
    const address = toSavedAddress(result.data);
    persistAddresses(editingAddress ? addresses.map((item) => item.id === address.id ? address : item) : [...addresses, address]);
    setAddressFormOpen(false);
    setEditingAddress(null);
    toast.success(editingAddress ? "Address updated" : "Address saved");
  };

  const savePayment = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const payment: SavedPayment = { ...paymentDraft, id: `${Date.now()}`, last4: paymentDraft.last4.slice(-4), isDefault: payments.length === 0 };
    persistPayments([...payments, payment]);
    setPaymentDraft({ holder: "", brand: "Visa", last4: "" });
    setPaymentFormOpen(false);
    toast.success("Payment method saved");
  };

  const setDefaultAddress = async (id: string) => {
    if (!user) return;
    // One database call, so there is never zero or two default addresses.
    const { error } = await supabase.rpc("set_default_address", { p_address: id });
    if (error) {
      toast.error(accountErrorMessage(error, "Changing the default address"));
      return;
    }
    persistAddresses(addresses.map((item) => ({ ...item, isDefault: item.id === id })));
    toast.success("Default address updated");
  };

  const removeAddress = async (address: SavedAddress) => {
    if (!user) return;
    const { error } = await supabase.from("yearth_addresses").delete().eq("id", address.id).eq("user_id", user.id);
    if (error) {
      setAccountError(accountErrorMessage(error, "Removing the address"));
      toast.error("Address could not be removed");
      return;
    }
    const remaining = addresses.filter((item) => item.id !== address.id);
    persistAddresses(remaining);
    if (address.isDefault && remaining[0]) await setDefaultAddress(remaining[0].id);
    toast.success("Address removed");
  };

  const setDefaultPayment = (id: string) => persistPayments(payments.map((item) => ({ ...item, isDefault: item.id === id })));
  const savePreferences = async (nextNewsletter = newsletter, nextOrderUpdates = orderUpdates) => {
    if (!user) return;
    setAccountError("");
    const { error } = await supabase.from("yearth_account_preferences").upsert({
      user_id: user.id, newsletter: nextNewsletter, order_updates: nextOrderUpdates,
      updated_at: new Date().toISOString(),
    }, { onConflict: "user_id" });
    if (error) { setAccountError(accountErrorMessage(error, "Saving your preferences")); toast.error("Preferences could not be saved"); return; }
    setNewsletter(nextNewsletter);
    setOrderUpdates(nextOrderUpdates);
    toast.success("Preferences updated");
  };

  const signOut = async () => {
    store.setProfile("");
    toast.success("Signed out successfully");
    await endSession();
  };

  const tabTitle = accountTabs.find((tab) => tab.id === activeTab)?.label || "Overview";

  if (profileError) {
    return <main className="container standard-page account-page !max-w-[1500px]"><div role="alert" className="rounded-2xl border border-red-300 bg-red-50 p-8 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300">{profileError}</div></main>;
  }
  const authLoading = !ready || !user || !profileReady || holdForProfile;
  if (authLoading || dataLoading) {
    return <main className="container standard-page account-page !max-w-[1500px]"><div className="rounded-2xl border border-neutral-200 p-8 text-sm text-neutral-500 dark:border-neutral-800">Loading your YEARTH account…</div></main>;
  }

  return (
    <main className="container standard-page account-page !max-w-[1500px]">
      <Breadcrumb name="My Account" />
      {accountError && <div role="alert" className="mb-5 rounded-xl border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300">{accountError}</div>}
      <header className="mb-7 border-b border-neutral-200 pb-6 dark:border-neutral-800">
        <p className="mb-2 text-xs font-semibold uppercase tracking-[.22em] text-neutral-500">THE YEARTH MEMBERS AREA</p>
        <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">My Account</h1>
        <p className="mt-2 text-sm text-neutral-500 sm:text-base">Manage your profile, orders, addresses, payments and preferences.</p>
      </header>

      <div className="grid items-start gap-7 lg:grid-cols-[230px_minmax(0,1fr)] xl:gap-9">
        <aside className="rounded-2xl border border-neutral-200 bg-white p-3 dark:border-neutral-800 dark:bg-neutral-950 lg:sticky lg:top-24">
          <div className="mb-3 flex items-center gap-3 rounded-xl bg-neutral-100 p-3 dark:bg-neutral-900">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-neutral-950 text-white dark:bg-white dark:text-neutral-950"><UserRound size={21} /></span>
            <div className="min-w-0"><p className="truncate text-sm font-semibold">{name || store.profile || "YEARTH Member"}</p><p className="text-xs text-neutral-500">Your account</p></div>
          </div>
          <nav aria-label="Account sections" className="grid gap-1 sm:grid-cols-2 lg:grid-cols-1">
            {accountTabs.map(({ id, label, icon: Icon }) => (
              <button key={id} type="button" onClick={() => { if (id === "orders") { navigate({ to: "/orders" }); return; } setActiveTab(id); }} className={`flex min-h-11 items-center gap-3 rounded-lg px-3 text-left text-sm transition ${activeTab === id ? "bg-neutral-950 font-medium text-white dark:bg-white dark:text-neutral-950" : "text-neutral-700 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-900"}`}>
                <Icon size={18} strokeWidth={1.7} /><span>{label}</span><ChevronRight size={15} className="ml-auto opacity-50" />
              </button>
            ))}
          </nav>
          <button type="button" onClick={() => void signOut()} className="mt-3 flex min-h-11 w-full items-center gap-3 rounded-lg border-t border-neutral-200 px-3 pt-3 text-left text-sm text-neutral-600 hover:text-red-600 dark:border-neutral-800 dark:text-neutral-400"><LogOut size={18} /> Sign out</button>
        </aside>

        <div className="min-w-0">
          {activeTab === "overview" && <div className="space-y-7">
            <div className="grid gap-4 xl:grid-cols-[1.1fr_.9fr]">
              <section className="rounded-2xl border border-neutral-200 p-5 sm:p-7 dark:border-neutral-800">
                <div className="flex flex-wrap items-center gap-4">
                  <span className="flex h-16 w-16 items-center justify-center rounded-full bg-neutral-950 text-white dark:bg-white dark:text-neutral-950"><UserRound size={30} /></span>
                  <div className="min-w-0 flex-1"><p className="text-[10px] font-semibold uppercase tracking-[.18em] text-neutral-500">Welcome back</p><h2 className="mt-1 text-2xl font-semibold tracking-tight">{name || store.profile || "Your YEARTH account"}</h2><p className="mt-1 truncate text-sm text-neutral-500">{email || "Add your email in Personal profile"}</p><span className="mt-2 inline-flex items-center gap-1 rounded-full bg-neutral-100 px-2.5 py-1 text-xs text-neutral-700 dark:bg-neutral-900 dark:text-neutral-300"><Check size={13} /> Account active</span></div>
                  <button type="button" onClick={() => setActiveTab("profile")} className="inline-flex items-center gap-2 text-sm font-medium underline underline-offset-4">Edit profile <Pencil size={14} /></button>
                </div>
                <div className="mt-6 grid grid-cols-3 border-t border-neutral-200 pt-5 dark:border-neutral-800">
                  <div><p className="text-2xl font-semibold">{addresses.length}</p><p className="mt-1 text-xs text-neutral-500">Addresses</p></div>
                  <div className="border-x border-neutral-200 px-4 dark:border-neutral-800"><p className="text-2xl font-semibold">{payments.length}</p><p className="mt-1 text-xs text-neutral-500">Payment methods</p></div>
                  <div className="pl-4"><p className="text-2xl font-semibold">{wishlistItems.length}</p><p className="mt-1 text-xs text-neutral-500">Wishlist items</p></div>
                </div>
              </section>
              <section className="relative flex min-h-52 flex-col justify-between overflow-hidden rounded-2xl bg-neutral-950 p-6 text-white sm:p-7">
                <div className="absolute -right-10 -top-12 h-48 w-48 rounded-full border border-white/10" /><div className="absolute -right-2 -top-4 h-32 w-32 rounded-full border border-white/10" />
                <div className="relative"><p className="text-[10px] font-semibold uppercase tracking-[.2em] text-neutral-400">THE YEARTH STORE</p><h2 className="mt-7 max-w-xs text-2xl font-semibold leading-tight">Better fits.<br />Bigger dreams.</h2></div>
                <Link to="/shop" className="relative mt-7 inline-flex w-fit items-center gap-3 text-xs font-semibold uppercase tracking-wider underline underline-offset-4">Explore collections <ArrowRight size={16} /></Link>
              </section>
            </div>
            <section>
              <div className="mb-3 flex items-center justify-between gap-3"><h2 className="text-xl font-semibold tracking-tight">Manage your account</h2><span className="text-xs text-neutral-500">Quick access</span></div>
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                {[
                  { title: "My orders", text: "Track deliveries and returns", icon: Package, action: () => navigate({ to: "/orders" }) },
                  { title: "Addresses", text: "Manage shipping addresses", icon: MapPin, action: () => setActiveTab("addresses") },
                  { title: "Payment methods", text: "Manage saved payment labels", icon: CreditCard, action: () => setActiveTab("payments") },
                  { title: "Security", text: "Review account settings", icon: ShieldCheck, action: () => setActiveTab("security") },
                ].map(({ title, text, icon: Icon, action }) => <button key={title} type="button" onClick={action} className="group flex min-h-32 items-start gap-3 rounded-xl border border-neutral-200 p-4 text-left transition hover:border-neutral-500 hover:shadow-sm dark:border-neutral-800"><Icon size={21} strokeWidth={1.6} /><span className="min-w-0 flex-1"><span className="block text-sm font-semibold">{title}</span><span className="mt-1 block text-xs leading-5 text-neutral-500">{text}</span></span><ArrowRight size={15} className="mt-1 transition group-hover:translate-x-1" /></button>)}
              </div>
            </section>
            <section className="rounded-2xl border border-neutral-200 p-5 dark:border-neutral-800"><div className="mb-4 flex items-center justify-between gap-3"><div><h2 className="text-xl font-semibold">Your wishlist</h2><p className="mt-1 text-sm text-neutral-500">The pieces you’ve saved for later.</p></div><button type="button" onClick={() => setActiveTab("wishlist")} className="inline-flex items-center gap-2 text-sm font-medium underline underline-offset-4">View wishlist <ArrowRight size={15} /></button></div>{wishlistItems.length ? <ProductGrid items={wishlistItems.slice(0, 4)} /> : <p className="rounded-xl bg-neutral-50 px-4 py-6 text-center text-sm text-neutral-500 dark:bg-neutral-900">Your saved favourites will appear here. Browse the collection to add some.</p>}</section>
          </div>}

          {activeTab === "profile" && <section className="rounded-2xl border border-neutral-200 p-5 sm:p-8 dark:border-neutral-800"><SectionHeading eyebrow="YOUR DETAILS" title="Personal profile" subtitle="Keep your contact details up to date for a smoother checkout." /><form className="mt-7 grid gap-5 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); persistProfile(); }}><Field label="Full name"><input className="field" value={name} onChange={(e) => setName(e.target.value)} required placeholder="Your full name" /></Field><Field label="Email address"><input className="field" type="email" value={email} readOnly aria-describedby="account-email-help" placeholder="you@example.com" /></Field><p id="account-email-help" className="text-xs text-neutral-500 sm:col-span-2">Email is managed by Supabase Auth and cannot be changed from this profile form.</p><Field label="Phone number"><input className="field" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+91 98765 43210" /></Field><div className="flex items-end"><Button type="submit" size="lg" className="w-full sm:w-auto">SAVE PROFILE <Check size={16} /></Button></div><PhoneVerificationNote phone={profile?.phone ?? ""} /></form><p className="mt-5 text-xs leading-5 text-neutral-500">Your name and phone number are saved to your signed-in account. Your email address comes from Supabase Auth and is managed through your sign-in settings.</p></section>}

          {activeTab === "addresses" && <section className="rounded-2xl border border-neutral-200 p-5 sm:p-8 dark:border-neutral-800"><div className="flex flex-wrap items-start justify-between gap-4"><SectionHeading eyebrow="DELIVERY DETAILS" title="Your addresses" subtitle="Save addresses for faster checkout next time." /><Button onClick={openNewAddress}><Plus size={17} /> ADD ADDRESS</Button></div>
            {addressFormOpen && <form onSubmit={saveAddress} className="mt-6 rounded-xl bg-neutral-50 p-4 sm:p-6 dark:bg-neutral-900"><div className="mb-4 flex items-center justify-between"><h3 className="font-semibold">{editingAddress ? "Edit address" : "Add a new address"}</h3><button type="button" onClick={() => setAddressFormOpen(false)} aria-label="Close address form"><X size={18} /></button></div><div className="grid gap-4 sm:grid-cols-2"><Field label="Address label"><select className="field" value={addressDraft.label} onChange={(e) => setAddressDraft({ ...addressDraft, label: e.target.value })}><option>Home</option><option>Work</option><option>Other</option></select></Field><Field label="Full name"><input className="field" required value={addressDraft.fullName} onChange={(e) => setAddressDraft({ ...addressDraft, fullName: e.target.value })} /></Field><Field label="Phone number"><input className="field" required type="tel" value={addressDraft.phone} onChange={(e) => setAddressDraft({ ...addressDraft, phone: e.target.value })} /></Field><Field label="Address line 1"><input className="field" required value={addressDraft.line1} onChange={(e) => setAddressDraft({ ...addressDraft, line1: e.target.value })} placeholder="House / flat, street" /></Field><Field label="Address line 2 (optional)"><input className="field" value={addressDraft.line2} onChange={(e) => setAddressDraft({ ...addressDraft, line2: e.target.value })} placeholder="Landmark, area" /></Field><Field label="City"><input className="field" required value={addressDraft.city} onChange={(e) => setAddressDraft({ ...addressDraft, city: e.target.value })} /></Field><Field label="State"><input className="field" required value={addressDraft.state} onChange={(e) => setAddressDraft({ ...addressDraft, state: e.target.value })} /></Field><Field label="PIN code"><input className="field" required inputMode="numeric" pattern="[0-9]{6}" maxLength={6} value={addressDraft.pincode} onChange={(e) => setAddressDraft({ ...addressDraft, pincode: e.target.value.replace(/\D/g, "") })} /></Field></div><div className="mt-5 flex flex-wrap gap-3"><Button type="submit">SAVE ADDRESS</Button><Button type="button" variant="outline" onClick={() => setAddressFormOpen(false)}>CANCEL</Button></div></form>}
            <div className="mt-6 grid gap-4 md:grid-cols-2">{addresses.map((address) => <article key={address.id} className="rounded-xl border border-neutral-200 p-5 dark:border-neutral-800"><div className="flex items-center justify-between gap-3"><span className="inline-flex items-center gap-2 text-sm font-semibold"><MapPin size={17} /> {address.label}</span>{address.isDefault && <span className="rounded-full bg-neutral-100 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide dark:bg-neutral-900">Default</span>}</div><p className="mt-4 font-medium">{address.fullName}</p><p className="mt-1 text-sm leading-6 text-neutral-500">{address.line1}{address.line2 ? `, ${address.line2}` : ""}<br />{address.city}, {address.state} {address.pincode}<br />{address.phone}</p><div className="mt-5 flex flex-wrap gap-3 border-t border-neutral-100 pt-4 dark:border-neutral-800">{!address.isDefault && <button type="button" onClick={() => setDefaultAddress(address.id)} className="text-xs font-medium underline underline-offset-4">Set as default</button>}<button type="button" onClick={() => { setEditingAddress(address); setAddressDraft({ label: address.label, fullName: address.fullName, phone: address.phone, line1: address.line1, line2: address.line2, city: address.city, state: address.state, pincode: address.pincode }); setAddressFormOpen(true); }} className="text-xs font-medium underline underline-offset-4">Edit</button><button type="button" onClick={() => void removeAddress(address)} className="inline-flex items-center gap-1 text-xs text-red-600"><Trash2 size={13} /> Remove</button></div></article>)}{!addresses.length && !addressFormOpen && <EmptyState icon={MapPin} title="No saved addresses yet" text="Add your home or work address to make checkout quicker." action="ADD YOUR FIRST ADDRESS" onAction={openNewAddress} />}</div>
          </section>}

          {activeTab === "payments" && <section className="rounded-2xl border border-neutral-200 p-5 sm:p-8 dark:border-neutral-800"><div className="flex flex-wrap items-start justify-between gap-4"><SectionHeading eyebrow="CHECKOUT PREFERENCES" title="Payment methods" subtitle="Keep a note of your preferred payment method. No full card details are stored here." /><Button onClick={() => setPaymentFormOpen(true)}><Plus size={17} /> ADD METHOD</Button></div><div className="mt-5 flex items-start gap-3 rounded-xl bg-neutral-50 p-4 text-sm leading-6 text-neutral-600 dark:bg-neutral-900 dark:text-neutral-300"><ShieldCheck size={19} className="mt-0.5 shrink-0" /><p>For your safety, this demo only stores the cardholder name, card brand and last four digits. Never enter your full card number, expiry or CVV here.</p></div>{paymentFormOpen && <form onSubmit={savePayment} className="mt-5 rounded-xl border border-neutral-200 p-4 sm:p-5 dark:border-neutral-800"><div className="grid gap-4 sm:grid-cols-3"><Field label="Cardholder name"><input className="field" required value={paymentDraft.holder} onChange={(e) => setPaymentDraft({ ...paymentDraft, holder: e.target.value })} /></Field><Field label="Payment brand"><select className="field" value={paymentDraft.brand} onChange={(e) => setPaymentDraft({ ...paymentDraft, brand: e.target.value })}><option>Visa</option><option>Mastercard</option><option>RuPay</option><option>UPI</option><option>Other</option></select></Field><Field label="Last four digits / UPI label"><input className="field" required minLength={4} maxLength={4} value={paymentDraft.last4} onChange={(e) => setPaymentDraft({ ...paymentDraft, last4: e.target.value.replace(/\s/g, "").slice(0, 4) })} placeholder="1234" /></Field></div><div className="mt-4 flex gap-3"><Button type="submit">SAVE METHOD</Button><Button type="button" variant="outline" onClick={() => setPaymentFormOpen(false)}>CANCEL</Button></div></form>}<div className="mt-6 grid gap-4 md:grid-cols-2">{payments.map((payment) => <article key={payment.id} className="rounded-xl border border-neutral-200 p-5 dark:border-neutral-800"><div className="flex items-start justify-between"><span className="flex h-11 w-14 items-center justify-center rounded-lg bg-neutral-100 dark:bg-neutral-900"><CreditCard size={22} /></span>{payment.isDefault && <span className="rounded-full bg-neutral-100 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide dark:bg-neutral-900">Default</span>}</div><p className="mt-5 font-semibold">{payment.brand} ···· {payment.last4}</p><p className="mt-1 text-sm text-neutral-500">{payment.holder}</p><div className="mt-5 flex gap-4 border-t border-neutral-100 pt-4 dark:border-neutral-800">{!payment.isDefault && <button type="button" onClick={() => setDefaultPayment(payment.id)} className="text-xs font-medium underline underline-offset-4">Set as default</button>}<button type="button" onClick={() => { persistPayments(payments.filter((item) => item.id !== payment.id)); toast.success("Payment method removed"); }} className="inline-flex items-center gap-1 text-xs text-red-600"><Trash2 size={13} /> Remove</button></div></article>)}{!payments.length && !paymentFormOpen && <EmptyState icon={CreditCard} title="No payment methods saved" text="Add a payment label for your own reference. Actual payments should be handled by a secure payment provider." action="ADD PAYMENT METHOD" onAction={() => setPaymentFormOpen(true)} />}</div></section>}

          {activeTab === "wishlist" && <section className="rounded-2xl border border-neutral-200 p-5 sm:p-8 dark:border-neutral-800"><SectionHeading eyebrow="SAVED FOR LATER" title={`Your wishlist (${wishlistItems.length})`} subtitle="All the pieces you’ve saved while browsing YEARTH." />{wishlistItems.length ? <div className="mt-6"><ProductGrid items={wishlistItems} /></div> : <EmptyState icon={Heart} title="Nothing saved just yet" text="When a product catches your eye, save it and it will show up here." action="EXPLORE THE COLLECTION" onAction={() => { window.location.href = "/shop"; }} />}</section>}

          {activeTab === "security" && <section className="rounded-2xl border border-neutral-200 p-5 sm:p-8 dark:border-neutral-800"><SectionHeading eyebrow="KEEP IT PROTECTED" title="Security & sign-in" subtitle="A few ways to keep your account details safe." /><div className="mt-6 divide-y divide-neutral-200 dark:divide-neutral-800">{[{ title: "Account session", desc: `Signed in as ${user?.email ?? "your YEARTH account"}.`, icon: UserRound }, { title: "Password & authentication", desc: "Your sign-in session is managed by Supabase Auth. Use the password reset flow on the sign-in page to change a forgotten password.", icon: ShieldCheck }, { title: "Personal data", desc: "Your profile, addresses and preferences are stored in your signed-in Supabase account. Payment labels remain local to this browser.", icon: Settings2 }].map(({ title, desc, icon: Icon }) => <div key={title} className="flex gap-4 py-5"><span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-neutral-100 dark:bg-neutral-900"><Icon size={19} /></span><div><h3 className="font-semibold">{title}</h3><p className="mt-1 max-w-2xl text-sm leading-6 text-neutral-500">{desc}</p></div></div>)}</div><Button variant="outline" className="mt-4" onClick={() => void signOut()}><LogOut size={16} /> Sign out</Button></section>}

          {activeTab === "preferences" && <section className="rounded-2xl border border-neutral-200 p-5 sm:p-8 dark:border-neutral-800"><SectionHeading eyebrow="MAKE IT YOURS" title="Account preferences" subtitle="Choose which updates you want to receive. Preferences are saved to your account." /><div className="mt-6 divide-y divide-neutral-200 dark:divide-neutral-800">{[{ title: "Product news & offers", desc: "Occasional updates about new drops and collections.", value: newsletter, change: (v: boolean) => { void savePreferences(v, orderUpdates); }, icon: Bell }, { title: "Order updates", desc: "Keep order and delivery updates enabled for this demo storefront.", value: orderUpdates, change: (v: boolean) => { void savePreferences(newsletter, v); }, icon: Package }].map(({ title, desc, value, change, icon: Icon }) => <div key={title} className="flex items-center gap-4 py-5"><span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-neutral-100 dark:bg-neutral-900"><Icon size={18} /></span><div className="flex-1"><h3 className="font-semibold">{title}</h3><p className="mt-1 text-sm text-neutral-500">{desc}</p></div><button type="button" role="switch" aria-checked={value} onClick={() => change(!value)} className={`relative h-6 w-11 shrink-0 rounded-full transition ${value ? "bg-neutral-950 dark:bg-white" : "bg-neutral-300 dark:bg-neutral-700"}`}><span className={`absolute top-1 h-4 w-4 rounded-full bg-white transition ${value ? "left-6 dark:bg-neutral-950" : "left-1"}`} /></button></div>)}</div></section>}
        </div>
      </div>
    </main>
  );
}

/** Shows whether the saved mobile number is verified (only once SMS verification is set up). */
function PhoneVerificationNote({ phone }: { phone: string }) {
  const { user } = useAuth();
  const fetchStatus = useServerFn(getPhoneVerificationStatus);
  const status = useQuery({
    queryKey: ["phone-verification", user?.id, phone],
    queryFn: () => fetchStatus(),
    enabled: !!user && !!phone,
    retry: false,
    staleTime: 60_000,
  });
  const s = status.data;
  if (!s?.enabled || !s.hasPhone) return null;
  if (s.verified) return <p className="inline-flex items-center gap-1 text-xs text-emerald-700 sm:col-span-2 dark:text-emerald-400"><Check size={14} /> Mobile number verified</p>;
  if (!s.supported) return <p className="text-xs text-neutral-500 sm:col-span-2">SMS verification is currently available for Indian (+91) mobile numbers only.</p>;
  return <p className="text-xs text-neutral-500 sm:col-span-2">Mobile number not verified. <Link to="/verify-phone" search={{ next: "/account" }} className="font-medium underline underline-offset-4">Verify now</Link></p>;
}

function SectionHeading({ eyebrow, title, subtitle }: { eyebrow: string; title: string; subtitle: string }) {
  return <div><p className="text-[10px] font-semibold uppercase tracking-[.2em] text-neutral-500">{eyebrow}</p><h2 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">{title}</h2><p className="mt-2 max-w-2xl text-sm leading-6 text-neutral-500">{subtitle}</p></div>;
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label className="block text-sm font-medium">{label}<span className="mt-2 block">{children}</span></label>;
}

function EmptyState({ icon: Icon, title, text, action, onAction }: { icon: ComponentType<{ size?: number; strokeWidth?: number }>; title: string; text: string; action: string; onAction: () => void }) {
  return <div className="flex min-h-48 flex-col items-center justify-center rounded-xl border border-dashed border-neutral-300 px-5 py-8 text-center dark:border-neutral-700 md:col-span-2"><span className="flex h-12 w-12 items-center justify-center rounded-full bg-neutral-100 dark:bg-neutral-900"><Icon size={22} strokeWidth={1.6} /></span><h3 className="mt-4 font-semibold">{title}</h3><p className="mt-2 max-w-md text-sm leading-6 text-neutral-500">{text}</p><Button type="button" variant="outline" className="mt-4" onClick={onAction}>{action} <ArrowRight size={15} /></Button></div>;
}
export function AboutPage() {
  return (
    <>
      <section className="about-campaign">
        <img src={campaign} alt="YEARTH premium oversized black cotton t-shirt" />
        <div className="container">
          <span className="eyebrow">LESS NOISE. MORE YOU.</span>
          <h1>THE YEARTH STORE</h1>
          <p>Everyday clothes. A little more considered.</p>
        </div>
      </section>
      <section className="container editorial-copy">
        <span className="eyebrow">THE EVERYDAY, REDEFINED</span>
        <h2>
          Good clothes don’t need
          <br />
          to shout.
        </h2>
        <p>
          We believe in the pieces you reach for again and again. A considered fit. A substantial
          feel. Colours that work with your life, not against it.
        </p>
        <p>
          Our oversized tees are made with 240 GSM premium cotton, with room to move and comfort
          that stays with you. Clean streetwear, without the excess.
        </p>
        <Button size="lg" asChild>
          <Link to="/shop">
            FIND YOUR EVERYDAY <ArrowRight />
          </Link>
        </Button>
      </section>
      <div className="benefit-band">
        <div className="container">
          <Benefits />
        </div>
      </div>
    </>
  );
}
export function ContactPage() {
  const sendMessage = useServerFn(submitContactMessage);
  const [sent, setSent] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  return (
    <section className="container standard-page contact-page">
      <Breadcrumb name="Contact" />
      <span className="eyebrow">LET’S TALK</span>
      <h1>We’re here for you.</h1>
      <p className="page-subtitle">A question about fit, an order, or just saying hello?</p>
      <div className="contact-layout">
        <div>
          <h2>A little help goes a long way.</h2>
          <p>Find answers about delivery, sizing and returns in our help centre.</p>
          <Link className="text-link" to="/help">
            VISIT HELP CENTRE <ArrowRight size={16} />
          </Link>
          <p className="info-note">
            Contact form for store support and order questions.
          </p>
        </div>
        {sent ? (
          <div className="contact-success">
            <h2>Thanks for reaching out.</h2>
            <p>Your message has been received. Our team will reply to the email address you gave.</p>
            <Button variant="outline" onClick={() => setSent(false)}>
              Send another message
            </Button>
          </div>
        ) : (
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              if (busy) return;
              const form = e.currentTarget;
              const f = new FormData(form);
              setBusy(true);
              setError("");
              try {
                await sendMessage({
                  data: {
                    name: String(f.get("name") ?? ""),
                    email: String(f.get("email") ?? ""),
                    topic: String(f.get("topic") ?? "") as "My order",
                    message: String(f.get("message") ?? ""),
                  },
                });
                form.reset();
                setSent(true);
              } catch (submitError) {
                setError(submitError instanceof Error ? submitError.message : "We couldn't send your message. Please try again.");
              } finally {
                setBusy(false);
              }
            }}
          >
            <label htmlFor="contact-name">Name</label>
            <input id="contact-name" name="name" className="field" required maxLength={100} autoComplete="name" />
            <label htmlFor="contact-email">Email</label>
            <input id="contact-email" name="email" type="email" className="field" required maxLength={255} autoComplete="email" />
            <label htmlFor="contact-topic">Topic</label>
            <select id="contact-topic" name="topic" className="field">
              <option>Product & sizing</option>
              <option>My order</option>
              <option>Returns & exchanges</option>
              <option>Something else</option>
            </select>
            <label htmlFor="contact-message">Message</label>
            <textarea id="contact-message" name="message" className="field" required minLength={10} maxLength={4000} rows={5} />
            {error && <p className="field-error" role="alert">{error}</p>}
            <Button type="submit" size="lg" disabled={busy}>
              {busy ? "SENDING…" : "SEND MESSAGE"}
              <ArrowRight />
            </Button>
          </form>
        )}
      </div>
    </section>
  );
}
const policyContent: Record<string, { title: string; intro: string; sections: string[][] }> = {
  "shipping-returns": {
    title: "Shipping & Returns",
    intro: "Everyday essentials, delivered to your door.",
    sections: [
      [
        "Delivery",
        "Pan India delivery. Orders ship in 1–2 days. Delivery times vary by destination.",
      ],
      [
        "Shipping charges",
        "Free shipping on orders above ₹999. Standard shipping is ₹79 for other orders.",
      ],
      [
        "Returns & exchanges",
        "7 days easy returns and exchanges. Contact support with your order number. Items should be unworn and in original condition.",
      ],
    ],
  },
  privacy: {
    title: "Privacy Policy",
    intro: "Your privacy matters.",
    sections: [
      [
        "Stored preferences",
        "We save your shopping bag, wishlist, account name and order details in this browser to keep your experience consistent.",
      ],
      [
        "Payments",
        "Payment information is handled securely by our payment provider. Never enter sensitive card details in an unverified environment.",
      ],
      [
        "Your choices",
        "You can remove locally saved browsing data using the control below.",
      ],
    ],
  },
  terms: {
    title: "Terms & Conditions",
    intro: "A considered shopping experience.",
    sections: [
      [
        "Store operations",
        "This store provides real product listings, pricing and order management for the YEARTH storefront.",
      ],
      [
        "Prices & shipping",
        "Prices are in Indian Rupees. Shipping and discount amounts are shown at checkout before order confirmation.",
      ],
      [
        "Order confirmation",
        "Orders are confirmed only after payment and fulfilment details are reviewed and accepted.",
      ],
    ],
  },
  help: {
    title: "How can we help?",
    intro: "A few answers for your everyday essentials.",
    sections: [
      [
        "Which size should I choose?",
        "Choose your usual size for our signature oversized fit. Open the size guide on any product page to compare measurements.",
      ],
      [
        "When will my order ship?",
        "Orders ship in 1–2 days. We deliver across India.",
      ],
      [
        "Can I return my order?",
        "We offer 7 days easy returns and exchanges. Please contact our team with your order details.",
      ],
      [
        "How can I track an order?",
        "Go to My Orders and choose Track Order for a shipped order. Tracking information is updated as your parcel moves through fulfilment.",
      ],
    ],
  },
};
export function InformationPage({ type }: { type: string }) {
  const content = policyContent[type] ?? policyContent["help"];
  if (!content) return null;
  return (
    <section className="container standard-page policy-page">
      <Breadcrumb name={content.title} />
      <h1>{content.title}</h1>
      <p className="page-subtitle">{content.intro}</p>
      {content.sections.map(([title, text]) => (
        <details open key={title}>
          <summary>{title}</summary>
          <p>{text}</p>
        </details>
      ))}
      {type === "privacy" && (
        <Button
          variant="outline"
          onClick={() => {
            // Browser copies only; data saved to a signed-in account stays in the account.
            for (const key of ["yearth-store-v1", "yearth-store-v2", "yearth-address", "yearth-account-payments"])
              localStorage.removeItem(key);
            sessionStorage.removeItem("yearth-checkout");
            window.location.reload();
          }}
        >
          Clear my saved data
        </Button>
      )}
      <Link className="text-link" to="/contact">
        Contact us <ArrowRight size={16} />
      </Link>
    </section>
  );
}


