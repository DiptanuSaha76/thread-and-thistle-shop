import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import {
  ArrowRight,
  Check,
  ShieldCheck,
  Smartphone,
  CreditCard,
  Landmark,
  Wallet,
  ArrowLeft,
  ShoppingBag,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { Summary, Benefits } from "./shared";
import { useStore } from "@/lib/store/state";
import { totals, money, type Address, type Order } from "@/lib/store/catalogue";
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
  const [address, setAddress] = useState<Address>(emptyAddress),
    [errors, setErrors] = useState<Partial<Address>>({}),
    [step, setStep] = useState(1),
    [payment, setPayment] = useState("cod"),
    [save, setSave] = useState(false),
    [busy, setBusy] = useState(false),
    [placed, setPlaced] = useState<Order | null>(null);
  const t = totals(store.cart, store.promo);
  useEffect(() => {
    try {
      const saved = JSON.parse(
        sessionStorage.getItem("yearth-checkout") ??
          localStorage.getItem("yearth-address") ??
          "null",
      );
      if (saved && Object.keys(emptyAddress).every((key) => typeof saved[key] === "string"))
        setAddress(saved);
    } catch {}
  }, []);
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
  const place = async () => {
    if (busy || !validate() || !store.cart.length) return;
    setBusy(true);
    let order: Order;
    try {
      order = await store.placeOrder({ ...address }, payment);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Order could not be placed");
      setBusy(false);
      return;
    }
    setPlaced(order);
    if (save)
      try {
        localStorage.setItem("yearth-address", JSON.stringify(address));
      } catch {}
    setBusy(false);
    try {
      sessionStorage.removeItem("yearth-checkout");
    } catch {}
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
      <div className="prototype-banner">
        <ShieldCheck size={16} />
        Demo checkout · No real payment or shipment
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
                {[
                  ["upi", "UPI", "Pay using any UPI app", Smartphone],
                  ["card", "Credit / Debit Card", "Visa, Mastercard, RuPay, etc.", CreditCard],
                  ["netbanking", "Net Banking", "All major banks", Landmark],
                  ["cod", "Cash on Delivery", "Pay at your doorstep", Wallet],
                ].map(([id, label, desc, Icon]) => {
                  const I = Icon as typeof Wallet;
                  return (
                    <label
                      key={String(id)}
                      className={`payment-option ${payment === id ? "selected" : ""}`}
                    >
                      <input
                        type="radio"
                        name="payment"
                        value={String(id)}
                        checked={payment === id}
                        onChange={() => setPayment(String(id))}
                      />
                      <I size={23} />
                      <span>
                        <b>{String(label)}</b>
                        <small>{String(desc)}</small>
                      </span>
                    </label>
                  );
                })}
              </div>
              <div className="payment-notice">
                {payment === "upi"
                  ? "UPI payment would open your chosen app in the live store."
                  : payment === "card"
                    ? "Card details would be entered securely with a payment provider. Do not enter card details in this demo."
                    : payment === "netbanking"
                      ? "Bank selection and authorisation would open with a payment provider."
                      : "Cash on Delivery selected."}
                <p>No payment is collected in this prototype.</p>
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
                  {
                    {
                      upi: "UPI",
                      card: "Credit / Debit Card",
                      netbanking: "Net Banking",
                      cod: "Cash on Delivery",
                    }[payment as "upi" | "card" | "netbanking" | "cod"]
                  }
                </p>
                <Button variant="link" onClick={() => setStep(2)}>
                  Change payment method
                </Button>
              </div>
              <Button size="lg" className="full-button" disabled={busy} onClick={place}>
                {busy ? "PLACING DEMO ORDER…" : `PLACE DEMO ORDER · ${money(t.total)}`}
                <ArrowRight />
              </Button>
              <p className="sample-note">
                No payment will be taken. This creates a demo order only.
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
                    : `Place Demo Order ${money(t.total)}`}
              <ArrowRight />
            </Button>
          </Summary>
          <Benefits compact />
        </div>
      </div>
    </section>
  );
}
