/**
 * Browser side of Razorpay Checkout. Only public values (key id, Razorpay order
 * id, amount) are used here; the payment is verified on the server afterwards.
 */

export type RazorpaySuccess = {
  razorpay_payment_id: string;
  razorpay_order_id: string;
  razorpay_signature: string;
};

type RazorpayInstance = { open: () => void; on: (event: string, handler: () => void) => void };
type RazorpayOptions = {
  key: string;
  order_id: string;
  amount: number;
  currency: string;
  name: string;
  description: string;
  prefill?: { name?: string; email?: string; contact?: string; method?: string };
  handler: (response: RazorpaySuccess) => void;
  modal: { ondismiss: () => void; confirm_close?: boolean };
  theme?: { color: string };
};
type RazorpayConstructor = new (options: RazorpayOptions) => RazorpayInstance;

declare global {
  interface Window {
    Razorpay?: RazorpayConstructor;
  }
}

const SCRIPT_SRC = "https://checkout.razorpay.com/v1/checkout.js";
let loading: Promise<RazorpayConstructor> | null = null;

function loadRazorpay(): Promise<RazorpayConstructor> {
  if (window.Razorpay) return Promise.resolve(window.Razorpay);
  loading ??= new Promise<RazorpayConstructor>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = SCRIPT_SRC;
    script.async = true;
    script.onload = () =>
      window.Razorpay
        ? resolve(window.Razorpay)
        : reject(new Error("Payment window failed to load"));
    script.onerror = () => {
      loading = null;
      script.remove();
      reject(new Error("Payment window failed to load"));
    };
    document.head.appendChild(script);
  });
  return loading;
}

/** Opens Razorpay Checkout. Resolves with the signed result, or null if the customer closes it. */
export async function payWithRazorpay(options: {
  keyId: string;
  razorpayOrderId: string;
  amount: number;
  currency: string;
  orderNumber: string;
  method?: "upi" | "card" | "netbanking";
  customer: { name: string; email: string; contact: string };
}): Promise<RazorpaySuccess | null> {
  const Razorpay = await loadRazorpay();
  return new Promise((resolve) => {
    const checkout = new Razorpay({
      key: options.keyId,
      order_id: options.razorpayOrderId,
      amount: options.amount,
      currency: options.currency,
      name: "THE YEARTH STORE",
      description: `Order #${options.orderNumber}`,
      prefill: {
        name: options.customer.name,
        email: options.customer.email,
        contact: options.customer.contact,
        ...(options.method ? { method: options.method } : {}),
      },
      handler: (response) => resolve(response),
      modal: { ondismiss: () => resolve(null), confirm_close: true },
      theme: { color: "#111111" },
    });
    checkout.open();
  });
}
