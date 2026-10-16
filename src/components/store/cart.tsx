import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { ArrowRight, Heart, Trash2, ShoppingBag, Truck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Breadcrumb, Quantity, Summary, Benefits, Related } from "./shared";
import { useStore } from "@/lib/store/state";
import { products, money, imageFor, lineKey, totals } from "@/lib/store/catalogue";
export function CartPage() {
  const store = useStore();
  const [code, setCode] = useState(store.promo),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  const t = totals(store.cart, store.promo),
    count = store.cart.reduce((n, l) => n + l.quantity, 0);
  const apply = async () => {
    setBusy(true);
    setMessage("");
    await new Promise((r) => setTimeout(r, 350));
    if (code.trim().toUpperCase() === "YEARTH10") {
      store.setPromo("YEARTH10");
      setMessage("Applied! Enjoy 10% off your items.");
    } else {
      store.setPromo("");
      setMessage("Invalid code. Try YEARTH10 for 10% off.");
    }
    setBusy(false);
  };
  return (
    <>
      <section className="container standard-page cart-page">
        <Breadcrumb name="Your Cart" />
        <div className="page-title-row">
          <h1>
            Your Cart <span>({count} items)</span>
          </h1>
          <Link className="text-link" to="/shop">
            Continue Shopping <ArrowRight size={16} />
          </Link>
        </div>
        {!store.cart.length ? (
          <div className="empty-state">
            <ShoppingBag size={48} />
            <h2>Your cart is empty</h2>
            <p>Your everyday essentials are waiting.</p>
            <Button size="lg" asChild>
              <Link to="/shop">
                Continue Shopping <ArrowRight />
              </Link>
            </Button>
          </div>
        ) : (
          <div className="cart-layout">
            <div>
              <div className="shipping-message">
                <Truck size={18} />
                {t.subtotal > 999
                  ? "Your order qualifies for free shipping."
                  : `Add ${money(1000 - t.subtotal)} more for free shipping.`}
              </div>
              <div className="cart-lines">
                {store.cart.map((l) => {
                  const p = products.find((p) => p.id === l.productId);
                  if (!p) return null;
                  return (
                    <article className="cart-line" key={lineKey(l)}>
                      <Link to="/products/$slug" params={{ slug: p.slug }}>
                        <img
                          src={imageFor(p, l.colour)}
                          alt={p.name}
                        />
                      </Link>
                      <div className="cart-line-info">
                        <Link
                          to="/products/$slug"
                          params={{ slug: p.slug }}
                          className="product-name"
                        >
                          {p.name}
                        </Link>
                        <p>
                          Size: {l.size} <span> / </span> Colour: {l.colour}
                        </p>
                        <b>{money(p.price)}</b>
                        <Quantity
                          value={l.quantity}
                          onChange={(n) => store.quantity(lineKey(l), n)}
                        />
                      </div>
                      <div className="cart-line-actions">
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={`Remove ${p.name}`}
                          onClick={() => store.remove(lineKey(l))}
                        >
                          <Trash2 />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={`Wishlist ${p.name}`}
                          onClick={() => store.wish(p.id)}
                        >
                          <Heart className={store.wishlist.includes(p.id) ? "heart-filled" : ""} />
                        </Button>
                        <b>{money(p.price * l.quantity)}</b>
                      </div>
                    </article>
                  );
                })}
              </div>
              <section className="promo-panel">
                <h3>Have a promo code?</h3>
                <p>Demo offer: YEARTH10 takes 10% off your items.</p>
                <div className="promo-entry">
                  <input
                    className="field"
                    aria-label="Promo code"
                    placeholder="Enter promo code"
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                  />
                  <Button disabled={busy} onClick={apply}>
                    {busy ? "Applying…" : "Apply"}
                  </Button>
                </div>
                {message && (
                  <p role="status" className={store.promo ? "text-success" : "field-error"}>
                    {message}
                  </p>
                )}
              </section>
            </div>
            <div>
              <Summary>
                <Button size="lg" className="full-button" asChild>
                  <Link to="/checkout">
                    PROCEED TO CHECKOUT <ArrowRight />
                  </Link>
                </Button>
              </Summary>
              <Benefits compact />
            </div>
          </div>
        )}
      </section>
      <Related />
      {count > 0 && (
        <div className="mobile-cart-action">
          <Button size="lg" asChild>
            <Link to="/checkout">
              Proceed to Checkout · {money(t.total)} <ArrowRight />
            </Link>
          </Button>
        </div>
      )}
    </>
  );
}
