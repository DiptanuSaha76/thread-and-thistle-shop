import black from "@/assets/black.jpg";
import white from "@/assets/off-white.jpg";
import brown from "@/assets/brown.jpg";
import olive from "@/assets/olive-green.jpg";
import backBlack from "@/assets/back-black.jpg";
import purple from "@/assets/purple.jpg";
import grey from "@/assets/grey.jpg";
import backWhite from "@/assets/back-off-white.jpg";

export const colours: string[] = ["Black", "Off-White", "Brown", "Olive Green", "Grey", "Purple"];
export const sizes: string[] = ["S", "M", "L", "XL", "XXL"];

export const assetByKey: Record<string, string> = {
  black,
  "off-white": white,
  brown,
  "olive-green": olive,
  "back-black": backBlack,
  purple,
  grey,
  "back-off-white": backWhite,
};

export type ShopColour = { name: string; hex: string };
export type CatalogueSettings = {
  categories: string[];
  colours: ShopColour[];
  price_min: number;
  price_max: number;
  filters: string[];
  free_shipping_threshold: number;
  shipping_fee: number;
  sizes: string[];
};

export const shopSettings = {
  categories: ["T-Shirts", "Hoodies", "Shirts", "Bottoms", "Accessories"],
  colours: [
    ["Black", "#111111"],
    ["Off-White", "#F2EEE6"],
    ["Brown", "#6B4A34"],
    ["Olive Green", "#5B6142"],
    ["Grey", "#8C8C8C"],
    ["Purple", "#5E4B7A"],
  ].map(([name, hex]) => ({ name, hex })) as ShopColour[],
  priceMin: 249,
  priceMax: 1499,
  filters: ["Category", "Size", "Color", "Price"],
  freeShippingThreshold: 999,
  shippingFee: 79,
};

export const allFilters = ["Category", "Size", "Color", "Price", "Availability", "Rating", "On Sale"];

/** Normalized database row; every field is JSON-serializable (no `unknown` values). */
export type CatalogueProductRow = {
  id: string;
  slug: string | null;
  name: string;
  price: number | null;
  rating: number | null;
  review_count: number | null;
  reviews: number | null;
  primary_colour: string | null;
  colour: string | null;
  image_key: string | null;
  image_url: string | null;
  images: string[] | null;
  category: string | null;
  badge: string | null;
  description: string | null;
  compare_at_price: number | null;
};

/** Normalized variant row sent from the server function to the browser. */
export type CatalogueVariantRow = {
  id: string;
  product_id: string;
  colour: string;
  colour_hex: string | null;
  size: string;
  stock: number;
  image_url: string | null;
};

export type Variant = {
  id: string;
  colour: string;
  hex: string;
  size: string;
  stock: number;
  image?: string | null;
};

/** Live variants by product id; empty until live records load. */
export const variants = new Map<string, Variant[]>();

export const colourHex = (name: string) => shopSettings.colours.find((c) => c.name === name)?.hex;
export const productColours = (p: Product) => {
  const list = [...new Set((variants.get(p.id) ?? []).map((v) => v.colour))];
  return list.length ? list : [p.colour];
};
export const productSizes = (p: Product) => {
  const list = [...new Set((variants.get(p.id) ?? []).map((v) => v.size))];
  return list.length ? sizes.filter((s) => list.includes(s)).concat(list.filter((s) => !sizes.includes(s))) : sizes;
};

export type Product = {
  id: string;
  slug: string;
  name: string;
  price: number;
  rating: number;
  reviews: number;
  colour: string;
  image: string;
  badge?: string | undefined;
  category: string;
  images?: string[] | undefined;
  compareAt?: number | null;
  // `| undefined` is intentional because `hydrateProducts` constructs this property explicitly.
  description?: string | undefined;
};

export const colourImages: Record<string, string> = {
  Black: black,
  "Off-White": white,
  Brown: brown,
  "Olive Green": olive,
  Grey: grey,
  Purple: purple,
};

export function imageFor(p: Product | undefined, colour: string) {
  if (!p) return colourImages[colour] ?? "";
  const v = (variants.get(p.id) ?? []).find((x) => x.colour === colour && x.image);
  return v?.image ?? (colour === p.colour ? p.image : colourImages[colour] ?? p.image);
}

export function hydrateProducts(rows: CatalogueProductRow[] = []): Product[] {
  if (!rows.length) return [];

  return rows
    .map((r): Product => {
      const rawColour = r.primary_colour ?? r.colour ?? "";
      const colour = colours.find((c) => c.toLowerCase() === rawColour.trim().toLowerCase()) ?? (rawColour.trim() || "Black");
      const fallbackImage = r.image_key ? assetByKey[r.image_key] ?? "" : "";
      const imageValue = r.image_url || r.images?.[0] || fallbackImage;

      return {
        id: r.id,
        slug: r.slug || r.id,
        name: r.name,
        price: r.price ?? 0,
        rating: r.rating ?? 0,
        reviews: r.review_count ?? r.reviews ?? 0,
        colour,
        // Keep products visible even if a database image field is empty.
        image: imageValue || colourImages[colour] || black,
        category: r.category || "T-Shirts",
        badge: r.badge ?? undefined,
        description: r.description ?? undefined,
        images: r.images ?? [],
        compareAt: r.compare_at_price,
      };
    })
    .filter((p) => p.id.length > 0 && p.name.trim().length > 0);
}

/** Shared mutable array updated after the live catalogue is fetched. */
export const products: Product[] = [];

export type CartLine = { productId: string; colour: string; size: string; quantity: number };
export type Address = {
  fullName: string;
  phone: string;
  address: string;
  city: string;
  state: string;
  pincode: string;
};
export type Order = {
  id: string;
  createdAt: string;
  status: "Processing" | "Shipped" | "Delivered" | "Cancelled";
  dbId?: string;
  tracking?: string | null;
  items: CartLine[];
  subtotal: number;
  shipping: number;
  discount: number;
  total: number;
  shippingAddress?: Address;
  paymentMethod: string;
};

export const money = (n: number) => "₹" + n.toLocaleString("en-IN");
export const lineKey = (line: CartLine) => [line.productId, line.colour, line.size].join("|");

export function totals(lines: CartLine[], promo = "") {
  const subtotal = lines.reduce(
    (sum, l) => sum + (products.find((p) => p.id === l.productId)?.price ?? 0) * l.quantity,
    0,
  );
  const shipping = subtotal === 0 || subtotal > shopSettings.freeShippingThreshold ? 0 : shopSettings.shippingFee;
  const discount = promo === "YEARTH10" ? Math.round(subtotal * 0.1) : 0;
  return { subtotal, shipping, discount, total: subtotal + shipping - discount };
}

export function stock(product: Product, colour: string, size: string) {
  const live = variants.get(product.id);
  if (live) return live.find((v) => v.colour === colour && v.size === size)?.stock ?? 0;
  return product.id === "purple" && colour === "Purple" && size === "XXL" ? 0 : 10;
}

export const savedOrders: Order[] = [];

export function pageHead(title: string, description: string) {
  return {
    meta: [
      { title: `${title} | THE YEARTH STORE` },
      { name: "description", content: description },
      { property: "og:title", content: `${title} | THE YEARTH STORE` },
      { property: "og:description", content: description },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  };
}
