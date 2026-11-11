import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";
import { useAuth } from "@/lib/auth";
import { getPublicCatalogue } from "./functions";
import { addMessage, addToBag, setLineQuantity, type AddMode, type AddOutcome } from "./bag";
import { dbErrorKey, isNetworkFailure, NETWORK_MESSAGE, orderErrorMessage } from "./errors";
import {
  CheckoutError,
  mergeCarts,
  ORDER_COLUMNS,
  sanitizeCart,
  sanitizeWishlist,
  toOrder,
  type OrderRow,
} from "./orders";
import {
  colourHex,
  hydrateProducts,
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
} from "./catalogue";

export type PaymentChoice = "cod";

type Store = {
  cart: CartLine[];
  wishlist: string[];
  orders: Order[];
  promo: string;
  /** Discount percent for `promo`, confirmed by the database (0 when none). */
  promoPercent: number;
  profile: string;
  ready: boolean;
  catalogueReady: boolean;
  catalogueError: string | null;
  version: number;
  /** Adds to the bag (see ./bag for the rules) and tells the customer what happened unless `quiet`. */
  add: (l: CartLine, options?: { mode?: AddMode; quiet?: boolean }) => AddOutcome;
  quantity: (key: string, n: number) => void;
  remove: (key: string) => void;
  wish: (id: string) => void;
  /** Checks a promo code with the database and applies it. Returns a message to show. */
  applyPromo: (code: string) => Promise<{ ok: boolean; message: string }>;
  clearPromo: () => void;
  /** Creates the order in the database. Does not empty the bag (see completeCheckout). */
  createOrder: (address: Address, payment: PaymentChoice, idempotencyKey: string) => Promise<Order>;
  /** Empties the bag and refreshes stock and orders after a successful checkout. */
  completeCheckout: () => Promise<void>;
  cancel: (id: string) => Promise<void>;
  refreshOrders: () => Promise<void>;
  setProfile: (s: string) => void;
};

const Context = createContext<Store | undefined>(undefined);

export function StoreProvider({ children }: { children: ReactNode }) {
  const { user, ready: authReady } = useAuth();
  const userId = user?.id ?? null;
  const [cart, setCartState] = useState<CartLine[]>([]),
    [wishlist, setWishlist] = useState<string[]>([]),
    [orders, setOrders] = useState<Order[]>([]),
    [promo, setPromo] = useState(""),
    [promoPercent, setPromoPercent] = useState(0),
    [profile, setProfile] = useState(""),
    [ready, setReady] = useState(false),
    [catalogueReady, setCatalogueReady] = useState(false),
    [catalogueError, setCatalogueError] = useState<string | null>(null),
    [version, setVersion] = useState(0),
    // The account whose saved bag has been merged into this browser's bag.
    [syncedUserId, setSyncedUserId] = useState<string | null>(null);
  const previousUserId = useRef<string | null>(null);
  // The bag as it is right now, including changes React has not rendered yet. Adds read this,
  // so several adds in a row (e.g. "Buy again") and their messages are always based on the
  // latest bag, never on a stale copy.
  const cartRef = useRef<CartLine[]>([]);
  const setCart = useCallback((next: CartLine[] | ((previous: CartLine[]) => CartLine[])) => {
    const value = typeof next === "function" ? next(cartRef.current) : next;
    cartRef.current = value;
    setCartState(value);
  }, []);

  const fetchCatalogue = useServerFn(getPublicCatalogue);

  const loadCatalogue = async () => {
    const result = await fetchCatalogue();
    const live: Product[] = hydrateProducts(result.products);

    products.splice(0, products.length, ...live);
    variants.clear();

    for (const row of result.variants) {
      // Defensive guard: malformed variant rows are filtered in functions.ts too.
      if (!row.product_id) continue;
      const list = variants.get(row.product_id) ?? [];
      list.push({
        id: row.id,
        colour: row.colour,
        hex: row.colour_hex ?? colourHex(row.colour) ?? "#111111",
        size: row.size,
        stock: row.stock,
        image: row.image_url,
      });
      variants.set(row.product_id, list);
    }

    for (const item of live) {
      if (!variants.has(item.id)) variants.set(item.id, []);
    }

    const st = result.settings;
    if (st) {
      if (st.categories.length) shopSettings.categories = st.categories;
      if (st.colours.length) shopSettings.colours = st.colours;
      shopSettings.priceMin = st.price_min;
      shopSettings.priceMax = st.price_max;
      if (st.filters.length) shopSettings.filters = st.filters;
      shopSettings.freeShippingThreshold = st.free_shipping_threshold;
      shopSettings.shippingFee = st.shipping_fee;
      if (st.sizes.length) sizes.splice(0, sizes.length, ...st.sizes);
      if (st.colours.length) colours.splice(0, colours.length, ...st.colours.map((c) => c.name));
    }
    setCatalogueError(null);
  };

  const fetchOrderRow = async (id: string) => {
    const { data, error } = await supabase.from("orders").select(ORDER_COLUMNS).eq("id", id).single();
    if (error || !data) throw new CheckoutError("Your order was placed but its details could not be loaded. Please check My Orders.", null);
    return toOrder(data as unknown as OrderRow);
  };

  const loadOrders = useCallback(async () => {
    const { data: auth } = await supabase.auth.getSession();
    if (!auth.session) return setOrders([]);

    const { data, error } = await supabase
      .from("orders")
      .select(ORDER_COLUMNS)
      .eq("user_id", auth.session.user.id)
      .order("created_at", { ascending: false });

    if (error) {
      console.error("[YEARTH] Could not load customer orders:", error.message);
      return;
    }
    setOrders(((data ?? []) as unknown as OrderRow[]).map(toOrder));
  }, []);

  const checkPromo = async (code: string) => {
    const { data, error } = await supabase.rpc("check_promo_code", { p_code: code });
    if (error) throw error;
    return typeof data === "number" && data > 0 ? data : null;
  };

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        await loadCatalogue();
      } catch (error) {
        console.error("[YEARTH] Failed to load catalogue:", error);
        if (alive) {
          setCatalogueError(
            error instanceof Error ? error.message : "Unable to load products. Please refresh and try again.",
          );
        }
      }
      if (!alive) return;

      setCatalogueReady(true);
      setVersion((n) => n + 1);

      try {
        const d = JSON.parse(localStorage.getItem("yearth-store-v2") ?? "null");
        if (d) {
          setCart(sanitizeCart(d.cart));
          setWishlist(sanitizeWishlist(d.wishlist));
          if (typeof d.profile === "string") setProfile(d.profile);
          if (typeof d.promo === "string" && d.promo) {
            // Re-check saved codes; they may have expired since they were applied.
            checkPromo(d.promo)
              .then((percent) => {
                if (!alive || !percent) return;
                setPromo(d.promo);
                setPromoPercent(percent);
              })
              .catch((error) => console.warn("[YEARTH] Could not re-check the saved promo code:", error));
          }
        }
      } catch (error) {
        console.warn("[YEARTH] Could not restore saved store state:", error);
      }

      setReady(true);
    })();

    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (ready) {
      try {
        localStorage.setItem("yearth-store-v2", JSON.stringify({ cart, wishlist, promo, profile }));
      } catch (error) {
        console.warn("[YEARTH] Could not save store state:", error);
      }
    }
  }, [cart, wishlist, promo, profile, ready]);

  // Explicit sign-out only: don't leave the previous customer's bag on a shared device.
  // (Their bag stays saved in their account and comes back when they sign in.)
  useEffect(() => {
    const { data } = supabase.auth.onAuthStateChange((event) => {
      if (event !== "SIGNED_OUT") return;
      setCart([]);
      setWishlist([]);
      setPromo("");
      setPromoPercent(0);
      setProfile("");
      setOrders([]);
      setSyncedUserId(null);
    });
    return () => data.subscription.unsubscribe();
  }, [setCart]);

  // Sign-in: load orders and merge the saved bag into this browser's bag.
  useEffect(() => {
    if (!authReady || !ready) return;
    const previous = previousUserId.current;
    previousUserId.current = userId;
    if (!userId) {
      setSyncedUserId(null);
      setOrders([]);
      return;
    }
    if (previous === userId) return;
    void loadOrders();
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from("customer_carts")
        .select("items, wishlist, promo_code")
        .eq("user_id", userId)
        .maybeSingle();
      if (cancelled) return;
      if (error) {
        // Keep the local bag; it is not written to the account until the saved bag can be read.
        console.error("[YEARTH] Could not load the saved bag:", error.message);
        return;
      }
      if (data) {
        setCart((local) => mergeCarts(sanitizeCart(data.items), local));
        setWishlist((local) => [...new Set([...sanitizeWishlist(data.wishlist), ...local])].slice(0, 200));
        if (data.promo_code) {
          const code = data.promo_code;
          checkPromo(code)
            .then((percent) => {
              if (cancelled || !percent) return;
              setPromo((current) => current || code);
              setPromoPercent((current) => current || percent);
            })
            .catch((e) => console.warn("[YEARTH] Could not re-check the saved promo code:", e));
        }
      }
      setSyncedUserId(userId);
    })();
    return () => {
      cancelled = true;
    };
  }, [authReady, ready, userId, loadOrders, setCart]);

  // Save the bag to the customer's account (debounced) once the saved bag has been merged.
  useEffect(() => {
    if (!userId || syncedUserId !== userId) return;
    const timer = setTimeout(() => {
      void supabase
        .from("customer_carts")
        .upsert({
          user_id: userId,
          items: cart as unknown as Json,
          wishlist: wishlist as unknown as Json,
          promo_code: promo || null,
          updated_at: new Date().toISOString(),
        })
        .then(({ error }) => {
          if (error) console.error("[YEARTH] Could not save the bag to the account:", error.message);
        });
    }, 600);
    return () => clearTimeout(timer);
  }, [cart, wishlist, promo, userId, syncedUserId]);

  const available = (l: Pick<CartLine, "productId" | "colour" | "size">) => {
    const product = products.find((p) => p.id === l.productId);
    return product ? stock(product, l.colour, l.size) : 0;
  };

  const add = (l: CartLine, options: { mode?: AddMode; quiet?: boolean } = {}) => {
    const { bag, outcome } = addToBag(cartRef.current, l, available(l), options.mode);
    if (bag !== cartRef.current) setCart(bag);
    if (!options.quiet) {
      const message = addMessage(outcome);
      if (message.tone === "success") toast.success(message.text);
      else if (message.tone === "error") toast.error(message.text);
      else toast(message.text);
    }
    return outcome;
  };

  const applyPromo = async (code: string) => {
    const trimmed = code.trim().toUpperCase();
    if (!trimmed) return { ok: false, message: "Enter a promo code." };
    try {
      const percent = await checkPromo(trimmed);
      if (!percent) {
        setPromo("");
        setPromoPercent(0);
        return { ok: false, message: "That promo code isn't valid." };
      }
      setPromo(trimmed);
      setPromoPercent(percent);
      return { ok: true, message: `Applied! Enjoy ${percent}% off your items.` };
    } catch (error) {
      return {
        ok: false,
        message: isNetworkFailure(error) ? NETWORK_MESSAGE : "We couldn't check that code. Please try again.",
      };
    }
  };

  const createOrder = async (address: Address, payment: PaymentChoice, idempotencyKey: string) => {
    const { data: auth } = await supabase.auth.getSession();
    if (!auth.session) throw new CheckoutError("Please sign in to place your order.", "AUTH_REQUIRED");

    const { data, error } = await supabase.rpc("create_order", {
      p_items: cart.map((l) => ({ productId: l.productId, colour: l.colour, size: l.size, quantity: l.quantity })),
      p_shipping: { ...address },
      p_payment: payment,
      p_idempotency_key: idempotencyKey,
      ...(promo ? { p_promo: promo } : {}),
    });
    if (error) {
      const code = dbErrorKey(error);
      if (!code) console.error("[YEARTH] Order creation failed:", error.message);
      if (code === "INVALID_PROMO") {
        setPromo("");
        setPromoPercent(0);
      }
      if (code === "OUT_OF_STOCK" || code === "PRODUCT_UNAVAILABLE") {
        void loadCatalogue()
          .then(() => setVersion((n) => n + 1))
          .catch(() => undefined);
      }
      throw new CheckoutError(orderErrorMessage(error), code);
    }
    const result = data as { id?: unknown } | null;
    if (!result || typeof result.id !== "string") {
      throw new CheckoutError("We couldn't confirm your order. Please check My Orders before trying again.", null);
    }
    return fetchOrderRow(result.id);
  };

  const completeCheckout = async () => {
    setCart([]);
    setPromo("");
    setPromoPercent(0);
    try {
      await loadCatalogue();
      setVersion((n) => n + 1);
    } catch (error) {
      console.error("[YEARTH] Catalogue refresh after order failed:", error);
    }
    await loadOrders();
  };


  return (
    <Context.Provider
      value={{
        cart,
        wishlist,
        orders,
        promo,
        promoPercent,
        profile,
        ready,
        catalogueReady,
        catalogueError,
        version,
        add,
        quantity: (key, n) => {
          const line = cartRef.current.find((l) => lineKey(l) === key);
          if (line) setCart((prev) => setLineQuantity(prev, key, n, available(line)));
        },
        remove: (key) => {
          const old = cartRef.current.find((l) => lineKey(l) === key);
          setCart((prev) => prev.filter((l) => lineKey(l) !== key));
          toast("Removed from your bag", {
            action: {
              label: "Undo",
              onClick: () => {
                // Puts back exactly what was removed (never doubles it if it was re-added).
                if (old) add(old, { mode: "ensure" });
              },
            },
          });
        },
        wish: (id) =>
          setWishlist((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id])),
        applyPromo,
        clearPromo: () => {
          setPromo("");
          setPromoPercent(0);
        },
        createOrder,
        completeCheckout,
        cancel: async (id) => {
          const order = orders.find((o) => o.id === id);
          if (!order?.dbId) return;
          const { error } = await supabase.rpc("cancel_order", { p_order: order.dbId });
          if (error) toast.error(orderErrorMessage(error));
          else toast.success("Order cancelled");
          await loadOrders();
        },
        refreshOrders: loadOrders,
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
