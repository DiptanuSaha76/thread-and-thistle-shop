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
      <div className="prototype-banner">
        Demo account · No real login or personal account is connected.
      </div>
      {!store.profile ? (
        <form
          className="account-form"
          onSubmit={(e) => {
            e.preventDefault();
            if (name.trim()) {
              store.setProfile(name.trim());
              toast.success("Welcome to your demo account");
            }
          }}
        >
          <UserRound size={32} />
          <h2>Make yourself at home.</h2>
          <label htmlFor="demo-name">Your name</label>
          <input
            id="demo-name"
            className="field"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            placeholder="First name"
          />
          <Button size="lg" type="submit">
            ENTER DEMO ACCOUNT <ArrowRight />
          </Button>
        </form>
      ) : (
        <Button variant="outline" onClick={() => store.setProfile("")}>
          Leave demo account
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
          <p className="sample-note">
            Demo contact form. Messages are not sent to a real support team.
          </p>
        </div>
        {sent ? (
          <div className="contact-success">
            <h2>Thanks for reaching out.</h2>
            <p>Your demo message was received locally. No email was sent.</p>
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
              {busy ? "SENDING…" : "SEND DEMO MESSAGE"}
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
        "Free shipping on orders above ₹999. The demo shipping fee for other orders is ₹79.",
      ],
      [
        "Returns & exchanges",
        "7 days easy returns and exchanges. Contact support with your order number. Items should be unworn and in original condition. This is a prototype policy; final terms must be confirmed before launch.",
      ],
    ],
  },
  privacy: {
    title: "Privacy Policy",
    intro: "Your privacy matters.",
    sections: [
      [
        "Prototype data",
        "This demo saves your shopping bag, wishlist, demo account name and orders in this browser. Shipping information is saved locally only when you request it. No data is submitted to a real store.",
      ],
      [
        "Payments",
        "No real payments are collected. Never enter sensitive payment information in this prototype.",
      ],
      [
        "Your choices",
        "You can remove locally stored demo data using the control below. A full production privacy policy must be supplied before launch.",
      ],
    ],
  },
  terms: {
    title: "Terms & Conditions",
    intro: "A considered shopping experience.",
    sections: [
      [
        "Prototype store",
        "This store is a functional front-end prototype. Products, ratings and orders are samples. No real purchase contract is created.",
      ],
      [
        "Prices & shipping",
        "Prices are in Indian Rupees. The prototype applies the shipping and discount amounts shown at checkout.",
      ],
      [
        "Before launch",
        "Real inventory, payments, fulfilment and final legal terms need to be connected and reviewed before accepting customer orders.",
      ],
    ],
  },
  help: {
    title: "How can we help?",
    intro: "A few answers for your everyday essentials.",
    sections: [
      [
        "Which size should I choose?",
        "Choose your usual size for our signature oversized fit. Open Size Guide on any product page to see sample measurements.",
      ],
      [
        "When will my order ship?",
        "Orders ship in 1–2 days. We deliver across India. Orders placed in this demo do not ship.",
      ],
      [
        "Can I return my order?",
        "We offer 7 days easy returns and exchanges. Please contact our team with your order details.",
      ],
      [
        "How can I track an order?",
        "Go to My Orders and choose Track Order for a shipped order. Tracking information in this prototype is sample data.",
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
          Clear my demo data
        </Button>
      )}
      <Link className="text-link" to="/contact">
        Contact us <ArrowRight size={16} />
      </Link>
    </section>
  );
}
