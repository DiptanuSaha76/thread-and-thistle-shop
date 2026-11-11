import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { ArrowRight, Check, ShieldCheck, Wallet, ArrowLeft, ShoppingBag } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { Summary, Benefits } from "./shared";
import { useStore } from "@/lib/store/state";
import { CheckoutError } from "@/lib/store/orders";
import { totals, money, type Address, type Order } from "@/lib/store/catalogue";
import { supabase } from "@/integrations/supabase/client";
import { useAuth, useCompleteProfileGate } from "@/lib/auth";

type PaymentId = "cod";
const newKey = () => crypto.randomUUID();
/** Indian mobile as 10 digits (accepts +91 / 91 prefixes and spaces). */
const tenDigits = (phone: string) => phone.replace(/\D/g, "").replace(/^91(?=\d{10}$)/, "");
const emptyAddress: Address = {
  fullName: "",
  phone: "",
  address: "",
  city: "",
  state: "",
  pincode: "",
};
const states = [
  "Andhra Pradesh",
  "Arunachal Pradesh",
  "Assam",
  "Bihar",
  "Chhattisgarh",
  "Goa",
  "Gujarat",
  "Haryana",
  "Himachal Pradesh",
  "Jharkhand",
  "Karnataka",
  "Kerala",
  "Madhya Pradesh",
  "Maharashtra",
  "Manipur",
  "Meghalaya",
  "Mizoram",
  "Nagaland",
  "Odisha",
  "Punjab",
  "Rajasthan",
  "Sikkim",
  "Tamil Nadu",
  "Telangana",
  "Tripura",
  "Uttar Pradesh",
  "Uttarakhand",
  "West Bengal",
  "Andaman and Nicobar Islands",
  "Chandigarh",
  "Dadra and Nagar Haveli and Daman and Diu",
  "Delhi",
  "Jammu and Kashmir",
  "Ladakh",
  "Lakshadweep",
  "Puducherry",
];
export function CheckoutPage() {
  const store = useStore();
  const { user, ready: authReady } = useAuth();
  const navigate = useNavigate();
  const holdForProfile = useCompleteProfileGate("/checkout");
  const [address, setAddress] = useState<Address>(emptyAddress),
    [errors, setErrors] = useState<Partial<Address>>({}),
    [step, setStep] = useState(1),
    [payment, setPayment] = useState<PaymentId>("cod"),
    [save, setSave] = useState(false),
    [busy, setBusy] = useState(false),
    [placed, setPlaced] = useState<Order | null>(null);
  // One key per checkout attempt: a retried request returns the same order instead of a duplicate.
  const attemptKey = useRef(newKey());
  const placing = useRef(false);
  const t = totals(store.cart, store.promoPercent);

  // Orders belong to an account: send signed-out shoppers to log in, then back here.
  useEffect(() => {
    if (authReady && !user && !placed)
      navigate({ to: "/login", search: { next: "/checkout" }, replace: true });
  }, [authReady, user, placed, navigate]);

  // Prefill: this tab's draft first, otherwise the customer's default saved address.
  useEffect(() => {
    try {
      const draft = JSON.parse(sessionStorage.getItem("yearth-checkout") ?? "null");
      if (draft && Object.keys(emptyAddress).every((key) => typeof draft[key] === "string")) {
        setAddress(draft);
        return;
      }
    } catch {
      // Ignore an unreadable draft.
    }
    if (!user) return;
    let alive = true;
    supabase
      .from("yearth_addresses")
      .select("full_name, phone, line1, line2, city, state, pincode")
      .eq("user_id", user.id)
      .order("is_default", { ascending: false })
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle()
      .then(({ data, error }) => {
        if (error) console.error("[checkout] Saved address could not be loaded:", error.message);
        if (!alive || !data) return;
        setAddress((current) =>
          Object.values(current).some((v) => v.trim())
            ? current
            : {
                fullName: data.full_name,
                phone: data.phone,
                address: [data.line1, data.line2].filter(Boolean).join(", "),
                city: data.city,
                state: data.state,
                pincode: data.pincode,
              },
        );
      });
    return () => {
      alive = false;
    };
  }, [user]);
  const update = (key: keyof Address, value: string) => {
    const next = { ...address, [key]: value };
    setAddress(next);
    setErrors((prev) => ({ ...prev, [key]: undefined }));
    try {
      sessionStorage.setItem("yearth-checkout", JSON.stringify(next));
    } catch {}
  };
  const validate = () => {
    const e: Partial<Address> = {};
    Object.keys(address).forEach((key) => {
      if (!address[key as keyof Address].trim())
        e[key as keyof Address] = "This field is required.";
    });
    const digits = address.phone.replace(/\D/g, "").replace(/^91(?=\d{10}$)/, "");
    if (!/^[6-9]\d{9}$/.test(digits)) e.phone = "Enter a valid 10-digit Indian phone number.";
    if (!/^[1-9]\d{5}$/.test(address.pincode)) e.pincode = "Enter a valid 6-digit pincode.";
    setErrors(e);
    return Object.keys(e).length === 0;
  };
  const next = () => {
    if (step === 1 && !validate()) return;
    setStep(Math.min(3, step + 1));
    window.scrollTo({ top: 0, behavior: "smooth" });
  };
  /** Saves the delivery address to the customer's account ("Save this address" box). */
  const saveAddressToAccount = async () => {
    if (!user) return;
    const phone = tenDigits(address.phone);
    const { data: existing, error: readError } = await supabase
      .from("yearth_addresses")
      .select("id, line1, pincode")
      .eq("user_id", user.id);
    if (readError) throw readError;
    const line1 = address.address.trim().slice(0, 200);
    if (existing.some((a) => a.line1 === line1 && a.pincode === address.pincode)) return;
    const { error } = await supabase.from("yearth_addresses").insert({
      user_id: user.id,
      label: existing.length ? "Other" : "Home",
      full_name: address.fullName.trim(),
      phone,
      line1,
      city: address.city.trim(),
      state: address.state,
      pincode: address.pincode,
      is_default: existing.length === 0,
    });
    if (error) throw error;
  };

  const finish = async (order: Order) => {
    setPlaced(order);
    attemptKey.current = newKey();
    try {
      sessionStorage.removeItem("yearth-checkout");
    } catch {
      // Draft cleanup is best-effort.
    }
    if (save)
      await saveAddressToAccount().catch((error) => {
        console.error("[checkout] Address could not be saved:", error);
        toast.error("Your order is placed, but the address could not be saved to your account.");
      });
    await store.completeCheckout();
  };

  const place = async () => {
    if (busy || placing.current || !validate() || !store.cart.length) return;
    if (!user) {
      navigate({ to: "/login", search: { next: "/checkout" } });
      return;
    }
    placing.current = true;
    setBusy(true);
    try {
      let order: Order;
      try {
        order = await store.createOrder({ ...address }, "cod", attemptKey.current);
      } catch (error) {
        if (error instanceof CheckoutError && error.code) {
          attemptKey.current = newKey(); // nothing was created; the next attempt is a new request
          if (error.code === "PROFILE_INCOMPLETE") {
            navigate({ to: "/complete-profile", search: { next: "/checkout" } });
            return;
          }
        }
        toast.error(error instanceof Error ? error.message : "Your order could not be placed. Please try again.");
        return;
      }
      await finish(order);
    } finally {
      placing.current = false;
      setBusy(false);
    }
  };
  if (placed)
    return (
      <section className="container confirmation">
        <div className="confirmation-icon">
          <Check size={36} />
        </div>
        <span className="eyebrow">ORDER CONFIRMED</span>
        <h1>Good things are on their way.</h1>
        <p>Order #{placed.id}</p>
        <p>We have received your order and will update you as it ships.</p>
        <div className="confirmation-summary">
          <span>{placed.items.reduce((n, l) => n + l.quantity, 0)} items</span>
          <b>{money(placed.total)}</b>
          <span>
            {placed.shippingAddress?.fullName} · {placed.shippingAddress?.city}
          </span>
        </div>
        <Button size="lg" asChild>
          <Link to="/orders">
            VIEW MY ORDERS <ArrowRight />
          </Link>
        </Button>
        <Link className="text-link" to="/shop">
          Continue shopping
        </Link>
      </section>
    );
  if (!authReady || !user || holdForProfile)
    return (
      <section className="container empty-state" aria-busy="true">
        <p>Preparing secure checkout…</p>
      </section>
    );
  if (!store.cart.length)
    return (
      <section className="container empty-state">
        <ShoppingBag size={44} />
        <h1>Your bag is empty</h1>
        <p>Add your favourites before checking out.</p>
        <Button asChild>
          <Link to="/shop">Shop the collection</Link>
        </Button>
      </section>
    );
  return (
    <section className="container standard-page checkout-page">
      <div className="checkout-progress" aria-label="Checkout progress">
        {["Cart", "Shipping", "Payment", "Review"].map((label, i) => (
          <div
            key={label}
            className={i === step ? "active" : i < step ? "complete" : ""}
            aria-current={i === step ? "step" : undefined}
          >
            {i === 0 ? (
              <Link to="/cart">
                <span>
                  <Check size={13} />
                </span>
                {label}
              </Link>
            ) : (
              <>
                <span>{i < step ? <Check size={13} /> : i + 1}</span>
                {label}
              </>
            )}
          </div>
        ))}
      </div>
      <div className="store-banner">
        <ShieldCheck size={16} />
        Secure checkout · review your order before placing it
      </div>
      <div className="checkout-layout">
        <div>
          {step === 1 ? (
            <>
              <h1>Delivery Information</h1>
              <p className="page-subtitle">Enter your shipping details</p>
              <form
                id="shipping-form"
                noValidate
                onSubmit={(e) => {
                  e.preventDefault();
                  next();
                }}
                className="delivery-form"
              >
                {(["fullName", "phone", "address", "city", "state", "pincode"] as const).map(
                  (key) => (
                    <div
                      className={`form-field ${key === "address" || key === "fullName" ? "form-wide" : ""}`}
                      key={key}
                    >
                      <label htmlFor={key}>
                        {
                          {
                            fullName: "Full Name",
                            phone: "Phone Number",
                            address: "Address",
                            city: "City",
                            state: "State",
                            pincode: "Pincode",
                          }[key]
                        }{" "}
                        <span aria-hidden="true">*</span>
                      </label>
                      {key === "state" ? (
                        <select
                          id={key}
                          className="field"
                          value={address[key]}
                          onChange={(e) => update(key, e.target.value)}
                          aria-invalid={!!errors[key]}
                          aria-describedby={errors[key] ? `${key}-error` : undefined}
                        >
                          <option value="">Select your state</option>
                          {states.map((s) => (
                            <option key={s}>{s}</option>
                          ))}
                        </select>
                      ) : (
                        <input
                          id={key}
                          className="field"
                          type={key === "phone" ? "tel" : "text"}
                          autoComplete={
                            {
                              fullName: "name",
                              phone: "tel",
                              address: "street-address",
                              city: "address-level2",
                              pincode: "postal-code",
                            }[key]
                          }
                          inputMode={key === "pincode" ? "numeric" : undefined}
                          value={address[key]}
                          onChange={(e) => update(key, e.target.value)}
                          aria-invalid={!!errors[key]}
                          aria-describedby={errors[key] ? `${key}-error` : undefined}
                          placeholder={
                            {
                              fullName: "Your full name",
                              phone: "+91 98765 43210",
                              address: "House / building, street, area",
                              city: "Your city",
                              pincode: "6-digit pincode",
                            }[key]
                          }
                        />
                      )}{" "}
                      {errors[key] && (
                        <p id={`${key}-error`} className="field-error" role="alert">
                          {errors[key]}
                        </p>
                      )}
                    </div>
                  ),
                )}
                <label className="check-row form-wide">
                  <input
                    type="checkbox"
                    checked={save}
                    onChange={(e) => setSave(e.target.checked)}
                  />
                  Save this address for future orders
                </label>
                <Button size="lg" type="submit" className="full-button form-wide">
                  CONTINUE TO PAYMENT <ArrowRight />
                </Button>
              </form>
            </>
          ) : step === 2 ? (
            <>
              <h1>Payment Method</h1>
              <p className="page-subtitle">Choose how you’d like to pay</p>
              <div className="payment-options">
                {[["cod", "Cash on Delivery", "Pay at your doorstep", Wallet]].map(([id, label, desc, Icon]) => {
                  const I = Icon as typeof Wallet;
                  const method = id as PaymentId;
                  const unavailable = false;
                  return (
                    <label
                      key={String(id)}
                      className={`payment-option ${payment === id ? "selected" : ""}`}
                      aria-disabled={unavailable || undefined}
                      style={unavailable ? { opacity: 0.55, cursor: "not-allowed" } : undefined}
                    >
                      <input
                        type="radio"
                        name="payment"
                        value={String(id)}
                        checked={payment === id}
                        disabled={unavailable}
                        onChange={() => setPayment(method)}
                      />
                      <I size={23} />
                      <span>
                        <b>{String(label)}</b>
                        <small>{unavailable ? "Not available yet" : String(desc)}</small>
                      </span>
                    </label>
                  );
                })}
              </div>
              <div className="payment-notice">
                Cash on Delivery selected.
                <p>Pay when your order arrives.</p>
              </div>
              <Button size="lg" className="full-button" onClick={next}>
                REVIEW ORDER <ArrowRight />
              </Button>
            </>
          ) : (
            <>
              <h1>Review Your Order</h1>
              <p className="page-subtitle">One last look at your everyday essentials</p>
              <div className="review-address">
                <h3>Deliver to</h3>
                <b>{address.fullName}</b>
                <p>
                  {address.address}
                  <br />
                  {address.city}, {address.state} {address.pincode}
                  <br />
                  {address.phone}
                </p>
                <Button variant="link" onClick={() => setStep(1)}>
                  Edit delivery details
                </Button>
              </div>
              <div className="review-address">
                <h3>Payment method</h3>
                <p>
                  Cash on Delivery
                </p>
                <Button variant="link" onClick={() => setStep(2)}>
                  Change payment method
                </Button>
              </div>
              <Button size="lg" className="full-button" disabled={busy} onClick={place}>
                {busy ? "PLACING ORDER…" : `PLACE ORDER · ${money(t.total)}`}
                <ArrowRight />
              </Button>
              <p className="info-note">
                Pay when your order arrives.
              </p>
            </>
          )}
          {step > 1 && (
            <Button variant="ghost" className="back-step" onClick={() => setStep(step - 1)}>
              <ArrowLeft />
              Back
            </Button>
          )}
        </div>
        <div>
          <Summary items>
            <Button
              size="lg"
              className="full-button"
              disabled={busy}
              onClick={step === 3 ? place : next}
            >
              {busy
                ? "PROCESSING…"
                : step === 1
                  ? `Proceed to Payment ${money(t.total)}`
                  : step === 2
                    ? `Review Order ${money(t.total)}`
                    : `Place Order ${money(t.total)}`}
              <ArrowRight />
            </Button>
          </Summary>
          <Benefits compact />
        </div>
      </div>
    </section>
  );
}
