import { useState, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import {
  Search,
  UserRound,
  ShoppingBag,
  Menu,
  Truck,
  Heart,
  ArrowUpRight,
  ArrowRight,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Modal, ProductGrid } from "./shared";
import { useStore } from "@/lib/store/state";
import { useAuth } from "@/lib/auth";
import { products } from "@/lib/store/catalogue";
const nav = [
  ["/", "HOME"],
  ["/shop", "SHOP"],
  ["/collections", "COLLECTIONS"],
  ["/about", "ABOUT"],
  ["/contact", "CONTACT"],
] as const;
export function StoreShell({ children }: { children: ReactNode }) {
  const store = useStore();
  const { user, signOut } = useAuth();
  const [menu, setMenu] = useState(false),
    [search, setSearch] = useState(false),
    [wish, setWish] = useState(false),
    [query, setQuery] = useState("");
  const count = store.cart.reduce((n, l) => n + l.quantity, 0);
  return (
    <>
      <div className="announcement">
        FREE SHIPPING ON ALL ORDERS ABOVE ₹999 <Truck size={14} />
      </div>
      <header className="site-header">
        <div className="container header-inner">
          <Link to="/" className="wordmark" aria-label="THE YEARTH STORE home">
            <span>THE</span> YEARTH <span>STORE</span>
            <i>®</i>
          </Link>
          <nav className="desktop-nav" aria-label="Main navigation">
            {nav.map(([to, label]) => (
              <Link key={to} to={to} activeOptions={{ exact: true }}>
                {label}
              </Link>
            ))}
          </nav>
          <div className="header-tools">
            <Button
              size="icon"
              variant="ghost"
              aria-label="Search products"
              onClick={() => setSearch(true)}
            >
              <Search />
            </Button>
            <Button size="icon" variant="ghost" asChild>
              <Link to={user ? "/account" : "/login"} aria-label={user ? "Account" : "Login or sign up"}>
                <UserRound />
              </Link>
            </Button>
            <Button
              size="icon"
              variant="ghost"
              className="desktop-wishlist"
              aria-label="Open wishlist"
              onClick={() => setWish(true)}
            >
              <Heart />
            </Button>
            <Button size="icon" variant="ghost" className="bag-button" asChild>
              <Link to="/cart" aria-label={`Shopping bag, ${count} items`}>
                <ShoppingBag />
                <span className="bag-count">{count}</span>
              </Link>
            </Button>
            <Button
              size="icon"
              variant="ghost"
              aria-label="Open menu"
              aria-expanded={menu}
              onClick={() => setMenu(true)}
            >
              <Menu />
            </Button>
          </div>
        </div>
      </header>
      <main>{children}</main>
      <footer className="site-footer container">
        <div className="footer-top">
          <Link to="/" className="wordmark">
            <span>THE</span> YEARTH <span>STORE</span>
            <i>®</i>
          </Link>
          <p>Less noise. More you.</p>
          <Link to="/shop">
            EVERYDAY ESSENTIALS <ArrowUpRight size={16} />
          </Link>
        </div>
        <div className="footer-bottom">
          <small>© {new Date().getFullYear()} THE YEARTH STORE</small>
          <nav aria-label="Footer navigation">
            {(
              [
                ["/shop", "Shop"],
                ["/collections", "Collections"],
                ["/about", "About"],
                ["/contact", "Contact"],
                ["/shipping-returns", "Shipping & Returns"],
                ["/privacy", "Privacy"],
                ["/terms", "Terms"],
                ["/help", "Help"],
              ] as const
            ).map(([to, label]) => (
              <Link key={to} to={to}>
                {label}
              </Link>
            ))}
          </nav>
        </div>
      </footer>
      <Modal open={menu} onOpenChange={setMenu} title="THE YEARTH STORE" drawer>
        <nav className="drawer-nav">
          {(
            [
              ...nav,
              ["/orders", "MY ORDERS"],
              ["/account", "ACCOUNT"],
              ["/help", "SUPPORT"],
            ] as const
          ).map(([to, label]) => (
            <Link key={to} to={to} onClick={() => setMenu(false)}>
              {label}
              <ArrowRight size={18} />
            </Link>
          ))}
          <Button
            variant="outline"
            onClick={() => {
              setMenu(false);
              setWish(true);
            }}
          >
            <Heart /> Wishlist ({store.wishlist.length})
          </Button>
          {user ? (
            <Button
              variant="ghost"
              onClick={() => {
                setMenu(false);
                void signOut();
              }}
            >
              Log out
            </Button>
          ) : (
            <Link to="/login" onClick={() => setMenu(false)}>
              Login / Sign Up <ArrowRight size={18} />
            </Link>
          )}
        </nav>
      </Modal>
      <Modal
        open={search}
        onOpenChange={setSearch}
        title="Find your everyday essential"
        description="Search the collection"
      >
        <input
          autoFocus
          className="field"
          aria-label="Search catalogue"
          placeholder="Search t-shirts, colours…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <div
          onClick={(e) => {
            if ((e.target as HTMLElement).closest("a")) setSearch(false);
          }}
        >
          <ProductGrid
            items={products.filter((p) => p.name.toLowerCase().includes(query.toLowerCase()))}
          />
          {!products.some((p) => p.name.toLowerCase().includes(query.toLowerCase())) && (
            <p>No matches. Try another colour or “tee”.</p>
          )}
        </div>
      </Modal>
      <Modal open={wish} onOpenChange={setWish} title={`Your wishlist (${store.wishlist.length})`}>
        <div
          onClick={(e) => {
            if ((e.target as HTMLElement).closest("a")) setWish(false);
          }}
        >
          <ProductGrid items={products.filter((p) => store.wishlist.includes(p.id))} />
          {!store.wishlist.length && (
            <div className="empty-state">
              <Heart />
              <h2>A little wishful thinking.</h2>
              <p>Save the pieces you love.</p>
              <Button onClick={() => setWish(false)}>Keep exploring</Button>
            </div>
          )}
        </div>
      </Modal>
    </>
  );
}
