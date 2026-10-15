import { useState, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import {
  ArrowRight,
  ChevronRight,
  Heart,
  Minus,
  Plus,
  Truck,
  Shirt,
  ShieldCheck,
  Flower2,
  RotateCcw,
  Headphones,
  Star,
  ShoppingBag,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { useStore } from "@/lib/store/state";
import { products, money, colourImages, totals, type Product } from "@/lib/store/catalogue";
export function Modal({
  open,
  onOpenChange,
  title,
  description,
  children,
  drawer = false,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title: string;
  description?: string;
  children: ReactNode;
  drawer?: boolean;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent placement={drawer ? "drawer" : "center"} className={drawer ? "store-modal store-drawer" : "store-modal"}>
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>{description ?? "THE YEARTH STORE"}</DialogDescription>
        {children}
      </DialogContent>
    </Dialog>
  );
}
export function Breadcrumb({ name }: { name: string }) {
  return (
    <div className="breadcrumb">
      <Link to="/">Home</Link>
      <ChevronRight size={12} />
      <Link to="/shop">Shop</Link>
      <ChevronRight size={12} />
      <span>{name}</span>
    </div>
  );
}
export function Swatches({
  selected,
  onChange,
  names = ["Black", "Off-White", "Brown", "Olive Green"],
}: {
  selected: string;
  onChange: (s: string) => void;
  names?: readonly string[];
}) {
  return (
    <div className="swatches">
      {names.map((name) => (
        <Button
          key={name}
          variant="swatch"
          size="icon"
          className={`swatch swatch-${name.toLowerCase().replaceAll(" ", "-")} ${selected === name ? "selected" : ""}`}
          aria-label={`Select ${name}`}
          title={name}
          aria-pressed={selected === name}
          onClick={() => onChange(name)}
        />
      ))}
    </div>
  );
}
export function Quantity({ value, onChange }: { value: number; onChange: (n: number) => void }) {
  return (
    <div className="quantity">
      <Button
        variant="ghost"
        size="icon"
        aria-label="Decrease quantity"
        disabled={value <= 1}
        onClick={() => onChange(value - 1)}
      >
        <Minus />
      </Button>
      <span aria-live="polite">{value}</span>
      <Button
        variant="ghost"
        size="icon"
        aria-label="Increase quantity"
        disabled={value >= 10}
        onClick={() => onChange(value + 1)}
      >
        <Plus />
      </Button>
    </div>
  );
}
export function ProductCard({
  product,
  showSwatches = false,
}: {
  product: Product;
  showSwatches?: boolean;
}) {
  const store = useStore();
  const [colour, setColour] = useState(product.colour);
  return (
    <article className="product-card">
      <div className="product-photo">
        <Link to="/products/$slug" params={{ slug: product.slug }}>
          <img
            src={colour === product.colour ? product.image : colourImages[colour]}
            alt={product.name}
            width={480}
            height={1024}
            loading="lazy"
          />
        </Link>
        {product.badge && <span className="product-badge">{product.badge}</span>}
        <Button
          size="icon"
          variant="floating"
          className="heart-control"
          aria-label={`${store.wishlist.includes(product.id) ? "Remove from" : "Add to"} wishlist: ${product.name}`}
          aria-pressed={store.wishlist.includes(product.id)}
          onClick={() => store.wish(product.id)}
        >
          <Heart className={store.wishlist.includes(product.id) ? "heart-filled" : ""} />
        </Button>
      </div>
      <Link className="product-name" to="/products/$slug" params={{ slug: product.slug }}>
        {product.name}
      </Link>
      <div className="rating" title="Sample ratings">
        <span aria-label={`${product.rating} out of 5 sample rating`}>
          {[1, 2, 3, 4, 5].map((n) => (
            <Star key={n} size={11} fill="currentColor" />
          ))}
        </span>
        <span>({product.reviews})</span>
      </div>
      <div className="product-price">{money(product.price)}</div>
      {showSwatches && (
        <Swatches
          selected={colour}
          onChange={setColour}
          names={[
            "Black",
            "Off-White",
            "Brown",
            "Olive Green",
            ...(product.colour === "Grey" || product.colour === "Purple" ? [product.colour] : []),
          ]}
        />
      )}
    </article>
  );
}
export function ProductGrid({
  items,
  showSwatches = false,
  list = false,
}: {
  items: Product[];
  showSwatches?: boolean;
  list?: boolean;
}) {
  return (
    <div className={`product-grid ${list ? "list-view" : ""}`}>
      {items.map((p) => (
        <ProductCard key={p.id} product={p} showSwatches={showSwatches} />
      ))}
    </div>
  );
}
export function SectionHeading({ title }: { title: string }) {
  return (
    <div className="section-heading">
      <h2>{title}</h2>
      <Link to="/shop">
        VIEW ALL <ArrowRight size={16} />
      </Link>
    </div>
  );
}
export function Related({ exclude }: { exclude?: string }) {
  return (
    <section className="container related">
      <SectionHeading title="YOU MAY ALSO LIKE" />
      <ProductGrid items={products.filter((p) => p.id !== exclude).slice(0, 4)} />
      <p className="sample-note">Ratings shown are sample reviews.</p>
    </section>
  );
}
const benefits = [
  [Flower2, "240 GSM", "PREMIUM COTTON"],
  [Shirt, "OVERSIZED FIT", "PERFECT STYLE"],
  [Truck, "PAN INDIA", "DELIVERY"],
  [ShieldCheck, "SECURE", "PAYMENT"],
] as const;
export function Benefits({ compact = false }: { compact?: boolean }) {
  return (
    <div className={`benefits ${compact ? "compact" : ""}`}>
      {benefits.map(([Icon, title, sub]) => (
        <div key={title}>
          <Icon strokeWidth={1.4} />
          <span>
            <b>{title}</b>
            <small>{sub}</small>
          </span>
        </div>
      ))}
    </div>
  );
}
export function TrustStrip() {
  return (
    <section className="trust-strip">
      <div className="container trust-grid">
        {[
          [ShieldCheck, "PREMIUM QUALITY", "We never compromise on quality."],
          [RotateCcw, "EASY RETURNS", "7 days easy returns & exchanges."],
          [Headphones, "CUSTOMER SUPPORT", "We are here to help you anytime."],
          [ShoppingBag, "SECURE PAYMENT", "100% secure payment methods."],
        ].map(([Icon, title, sub]) => {
          const I = Icon as typeof ShieldCheck;
          return (
            <div key={String(title)}>
              <I strokeWidth={1.3} />
              <span>
                <b>{String(title)}</b>
                <small>{String(sub)}</small>
              </span>
            </div>
          );
        })}
      </div>
    </section>
  );
}
export function Summary({ children, items = false }: { children?: ReactNode; items?: boolean }) {
  const { cart, promo } = useStore();
  const t = totals(cart, promo);
  return (
    <aside className="summary">
      <h2>Order Summary</h2>
      {items && (
        <>
          <Link className="text-link" to="/cart">
            Edit Cart
          </Link>
          {cart.map((l, i) => {
            const p = products.find((p) => p.id === l.productId);
            return (
              p && (
                <div className="summary-item" key={i}>
                  <img src={colourImages[l.colour] ?? p.image} alt={p.name} />
                  <div>
                    <b>{p.name}</b>
                    <small>
                      {l.size} / {l.colour} · Qty {l.quantity}
                    </small>
                  </div>
                  <span>{money(p.price * l.quantity)}</span>
                </div>
              )
            );
          })}
        </>
      )}
      <dl>
        <div>
          <dt>Subtotal</dt>
          <dd>{money(t.subtotal)}</dd>
        </div>
        <div>
          <dt>Shipping</dt>
          <dd className={!t.shipping ? "text-success" : ""}>
            {t.shipping ? money(t.shipping) : "Free"}
          </dd>
        </div>
        {t.discount > 0 && (
          <div>
            <dt>Discount (10%)</dt>
            <dd>−{money(t.discount)}</dd>
          </div>
        )}
        <div className="summary-total">
          <dt>Total</dt>
          <dd>{money(t.total)}</dd>
        </div>
      </dl>
      {children}
      <p className="secure-note">
        <ShieldCheck size={14} /> Safe & secure checkout
      </p>
    </aside>
  );
}
