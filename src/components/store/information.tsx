import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { toast } from "sonner";
import { ArrowRight, UserRound, Package, Heart, Headphones } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Breadcrumb, ProductGrid, Benefits } from "./shared";
import { useStore } from "@/lib/store/state";
import { products } from "@/lib/store/catalogue";
import campaign from "@/assets/campaign.jpg";
export function AccountPage() {
  const store = useStore();
  const [name, setName] = useState("");
  return (
    <section className="container standard-page account-page">
      <Breadcrumb name="Account" />
      <h1>{store.profile ? `Hello, ${store.profile}.` : "Your YEARTH account"}</h1>
      <p className="page-subtitle">Your essentials, all in one place.</p>
      <div className="store-banner">
        Personal account · manage your saved items and orders.
      </div>
      {!store.profile ? (
        <form
          className="account-form"
          onSubmit={(e) => {
            e.preventDefault();
            if (name.trim()) {
              store.setProfile(name.trim());
              toast.success("Welcome to your account");
            }
          }}
        >
          <UserRound size={32} />
          <h2>Make yourself at home.</h2>
          <label htmlFor="account-name">Your name</label>
          <input
            id="account-name"
            className="field"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            placeholder="First name"
          />
          <Button size="lg" type="submit">
            ENTER ACCOUNT <ArrowRight />
          </Button>
        </form>
      ) : (
        <Button variant="outline" onClick={() => store.setProfile("")}>
          Leave account
        </Button>
      )}
      <div className="account-links">
        <Link to="/orders">
          <Package />
          <span>My Orders</span>
          <ArrowRight />
        </Link>
        <Link to="/contact">
          <Headphones />
          <span>Contact & support</span>
          <ArrowRight />
        </Link>
      </div>
      <section className="account-wishlist">
        <h2>
          <Heart size={22} /> Your Wishlist ({store.wishlist.length})
        </h2>
        {store.wishlist.length ? (
          <ProductGrid items={products.filter((p) => store.wishlist.includes(p.id))} />
        ) : (
          <p>Your saved favourites will appear here.</p>
        )}
      </section>
    </section>
  );
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
  const [sent, setSent] = useState(false),
    [busy, setBusy] = useState(false);
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
            <p>Your message has been sent successfully.</p>
            <Button variant="outline" onClick={() => setSent(false)}>
              Send another message
            </Button>
          </div>
        ) : (
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              if (busy) return;
              setBusy(true);
              await new Promise((r) => setTimeout(r, 400));
              setSent(true);
              setBusy(false);
            }}
          >
            <label htmlFor="contact-name">Name</label>
            <input id="contact-name" className="field" required />
            <label htmlFor="contact-email">Email</label>
            <input id="contact-email" type="email" className="field" required />
            <label htmlFor="contact-topic">Topic</label>
            <select id="contact-topic" className="field">
              <option>Product & sizing</option>
              <option>My order</option>
              <option>Returns & exchanges</option>
              <option>Something else</option>
            </select>
            <label htmlFor="contact-message">Message</label>
            <textarea id="contact-message" className="field" required rows={5} />
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
            localStorage.removeItem("yearth-store-v1");
            localStorage.removeItem("yearth-address");
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
