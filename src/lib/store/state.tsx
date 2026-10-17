import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import {
  assetByKey,
  colourImages,
  lineKey,
  products,
  sizes,
  colours,
  shopSettings,
  stock,
  variants,
  type Address,
  type CartLine,
  type Order,
  type Product,
  type ShopColour,
} from "./catalogue";
type Store = {
  cart: CartLine[];
  wishlist: string[];
  orders: Order[];
  promo: string;
  profile: string;
  ready: boolean;
  catalogueReady: boolean;
  version: number;
  add: (l: CartLine) => void;
  quantity: (key: string, n: number) => void;
  remove: (key: string) => void;
  wish: (id: string) => void;
  setPromo: (s: string) => void;
  placeOrder: (address: Address, payment: string) => Promise<Order>;
  cancel: (id: string) => Promise<void>;
  setProfile: (s: string) => void;
};
const Context = createContext<Store | undefined>(undefined);
type OrderRow = {
  id: string;
  order_number: string;
  created_at: string;
  status: string;
  subtotal: number;
  shipping: number;
  discount: number;
  total: number;
  payment_method: string;
  tracking_number: string | null;
  ship_name: string;
  ship_phone: string;
  ship_address: string;
  ship_city: string;
  ship_state: string;
  ship_pincode: string;
  order_items: { product_id: string | null; colour: string; size: string; quantity: number }[];
};
const toOrder = (o: OrderRow): Order => ({
  id: o.order_number,
  dbId: o.id,
  createdAt: o.created_at,
  status: o.status as Order["status"],
  items: o.order_items.map((i) => ({
    productId: i.product_id ?? "",
    colour: i.colour,
    size: i.size,
    quantity: i.quantity,
  })),
  subtotal: o.subtotal,
  shipping: o.shipping,
  discount: o.discount,
  total: o.total,
  tracking: o.tracking_number,
  paymentMethod: o.payment_method === "cod" ? "Cash on Delivery" : "Online payment",
  shippingAddress: {
    fullName: o.ship_name,
    phone: o.ship_phone,
    address: o.ship_address,
    city: o.ship_city,
    state: o.ship_state,
    pincode: o.ship_pincode,
  },
});
async function loadCatalogue() {
  const [p, v, s] = await Promise.all([
    supabase.from("products").select("*").eq("active", true).order("sort_order"),
    supabase.from("product_variants").select("*"),
    supabase.from("store_settings").select("*").eq("id", 1).maybeSingle(),
  ]);
  if (p.error || v.error) throw new Error("catalogue");
  const live: Product[] = (p.data ?? []).map((r) => ({
    id: r.id,
    slug: r.slug,
    name: r.name,
    price: r.price,
    compareAt: r.compare_at_price,
    rating: Number(r.rating),
    reviews: r.review_count,
    colour: r.primary_colour,
    image:
      r.image_url ||
      r.images?.[0] ||
      (r.image_key ? assetByKey[r.image_key] : undefined) ||
      colourImages[r.primary_colour] ||
      "",
    images: r.images ?? [],
    category: r.category,
    badge: r.badge ?? undefined,
    description: r.description,
  }));
  products.splice(0, products.length, ...live);
  variants.clear();
  for (const row of v.data ?? []) {
    const list = variants.get(row.product_id) ?? [];
    list.push({ id: row.id, colour: row.colour, hex: row.colour_hex, size: row.size, stock: row.stock, image: row.image_url });
    variants.set(row.product_id, list);
  }
  for (const item of live) if (!variants.has(item.id)) variants.set(item.id, []);
  const st = s.data;
  if (st) {
    shopSettings.categories = st.categories;
    shopSettings.colours = (Array.isArray(st.colours) ? st.colours : []) as ShopColour[];
    shopSettings.priceMin = st.price_min;
    shopSettings.priceMax = st.price_max;
    shopSettings.filters = st.filters;
    shopSettings.freeShippingThreshold = st.free_shipping_threshold;
    shopSettings.shippingFee = st.shipping_fee;
    sizes.splice(0, sizes.length, ...st.sizes);
    colours.splice(0, colours.length, ...shopSettings.colours.map((c) => c.name));
  }
}
export function StoreProvider({ children }: { children: ReactNode }) {
  const [cart, setCart] = useState<CartLine[]>([]),
    [wishlist, setWishlist] = useState<string[]>([]),
    [orders, setOrders] = useState<Order[]>([]),
    [promo, setPromo] = useState(""),
    [profile, setProfile] = useState(""),
    [ready, setReady] = useState(false),
    [catalogueReady, setCatalogueReady] = useState(false),
    [version, setVersion] = useState(0);
  const loadOrders = async () => {
    const { data: auth } = await supabase.auth.getSession();
    if (!auth.session) return setOrders([]);
    const { data } = await supabase
      .from("orders")
      .select("*, order_items(product_id,colour,size,quantity)")
      .eq("user_id", auth.session.user.id)
      .order("created_at", { ascending: false });
    setOrders(((data ?? []) as OrderRow[]).map(toOrder));
  };
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        await loadCatalogue();
      } catch {}
      if (!alive) return;
      setCatalogueReady(true);
      setVersion((n) => n + 1);
      try {
        const d = JSON.parse(localStorage.getItem("yearth-store-v2") ?? "null");
        if (d) {
          if (Array.isArray(d.cart))
            setCart(
              d.cart
                .filter(
                  (l: CartLine) =>
                    products.some((p) => p.id === l.productId) &&
                    typeof l.size === "string" &&
                    typeof l.colour === "string" &&
                    Number.isInteger(l.quantity) &&
                    l.quantity > 0,
                )
                .map((l: CartLine) => ({ ...l, quantity: Math.min(l.quantity, 10) })),
            );
          if (Array.isArray(d.wishlist))
            setWishlist(d.wishlist.filter((id: string) => products.some((p) => p.id === id)));
          if (typeof d.promo === "string") setPromo(d.promo);
          if (typeof d.profile === "string") setProfile(d.profile);
        }
      } catch {}
      setReady(true);
      void loadOrders();
    })();
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_IN" || event === "SIGNED_OUT") void loadOrders();
    });
    return () => {
      alive = false;
      sub.subscription.unsubscribe();
    };
  }, []);
  useEffect(() => {
    if (ready)
      try {
        localStorage.setItem("yearth-store-v2", JSON.stringify({ cart, wishlist, promo, profile }));
      } catch {}
  }, [cart, wishlist, promo, profile, ready]);
  const add = (l: CartLine) => {
    const product = products.find((p) => p.id === l.productId);
    if (!product || stock(product, l.colour, l.size) === 0) {
      toast.error("This variant is out of stock");
      return;
    }
    const max = Math.min(10, stock(product, l.colour, l.size));
    setCart((prev) => {
      const old = prev.find((x) => lineKey(x) === lineKey(l));
      return old
        ? prev.map((x) =>
            lineKey(x) === lineKey(l) ? { ...x, quantity: Math.min(max, x.quantity + l.quantity) } : x,
          )
        : [...prev, { ...l, quantity: Math.min(max, l.quantity) }];
    });
    toast.success("Added to your bag");
  };
  const placeOrder = async (address: Address, payment: string) => {
    const { data: auth } = await supabase.auth.getSession();
    if (!auth.session) throw new Error("Please sign in to place your order.");
    const { data, error } = await supabase.rpc("place_order", {
      p_items: cart,
      p_shipping: address,
      p_payment: payment === "cod" ? "cod" : "razorpay",
      p_promo: promo,
    });
    if (error) throw new Error(error.message);
    const result = data as { id: string };
    const { data: row } = await supabase
      .from("orders")
      .select("*, order_items(product_id,colour,size,quantity)")
      .eq("id", result.id)
      .single();
    setCart([]);
    setPromo("");
    try {
      await loadCatalogue();
      setVersion((n) => n + 1);
    } catch {}
    void loadOrders();
    return toOrder(row as OrderRow);
  };
  return (
    <Context.Provider
      value={{
        cart,
        wishlist,
        orders,
        promo,
        profile,
        ready,
        catalogueReady,
        version,
        add,
        quantity: (key, n) =>
          setCart((prev) =>
            prev.map((l) =>
              lineKey(l) === key ? { ...l, quantity: Math.max(1, Math.min(10, n)) } : l,
            ),
          ),
        remove: (key) => {
          const old = cart.find((l) => lineKey(l) === key);
          setCart((prev) => prev.filter((l) => lineKey(l) !== key));
          toast("Removed from your bag", {
            action: {
              label: "Undo",
              onClick: () => {
                if (old) add(old);
              },
            },
          });
        },
        wish: (id) =>
          setWishlist((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id])),
        setPromo,
        placeOrder,
        cancel: async (id) => {
          const order = orders.find((o) => o.id === id);
          if (!order?.dbId) return;
          const { error } = await supabase.rpc("cancel_my_order", { p_order: order.dbId });
          if (error) toast.error(error.message);
          else toast.success("Order cancelled");
          await loadOrders();
        },
        setProfile,
      }}
    >
      {children}
    </Context.Provider>
  );
}
export function useStore() {
  const value = useContext(Context);
  if (!value) throw new Error("useStore must be used inside StoreProvider");
  return value;
}
