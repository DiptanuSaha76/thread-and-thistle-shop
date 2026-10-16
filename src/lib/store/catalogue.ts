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
export const assetByKey: Record<string, string> = { black, "off-white": white, brown, "olive-green": olive, "back-black": backBlack, purple, grey, "back-off-white": backWhite };
export type ShopColour = { name: string; hex: string };
export const shopSettings = {
  categories: ["T-Shirts", "Hoodies", "Shirts", "Bottoms", "Accessories"],
  colours: [["Black", "#111111"], ["Off-White", "#F2EEE6"], ["Brown", "#6B4A34"], ["Olive Green", "#5B6142"], ["Grey", "#8C8C8C"], ["Purple", "#5E4B7A"]].map(([name, hex]) => ({ name, hex })) as ShopColour[],
  priceMin: 249,
  priceMax: 1499,
  filters: ["Category", "Size", "Color", "Price"],
  freeShippingThreshold: 999,
  shippingFee: 79,
};
export const allFilters = ["Category", "Size", "Color", "Price", "Availability", "Rating", "On Sale"];
export type Variant = { id: string; colour: string; hex: string; size: string; stock: number; image?: string | null };
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
export function imageFor(p: Product | undefined, colour: string) {
  if (!p) return colourImages[colour] ?? "";
  const v = (variants.get(p.id) ?? []).find((x) => x.colour === colour && x.image);
  return v?.image ?? (colour === p.colour ? p.image : colourImages[colour] ?? p.image);
}
export const colourImages: Record<string, string> = {
  Black: black,
  "Off-White": white,
  Brown: brown,
  "Olive Green": olive,
  Grey: grey,
  Purple: purple,
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
  images?: string[];
  compareAt?: number | null;
  description?: string;
};
export const products: Product[] = [
  ["black", "Oversized Black Tee", 649, 4.8, 24, "Black", black],
  ["off-white", "Oversized Off-White Tee", 649, 4.7, 18, "Off-White", white],
  ["brown", "Oversized Brown Tee", 649, 4.7, 15, "Brown", brown],
  ["olive-green", "Oversized Olive Green Tee", 649, 4.8, 21, "Olive Green", olive],
  ["back-black", "Back Print Black Tee", 699, 4.9, 32, "Black", backBlack],
  ["purple", "Oversized Purple Tee", 649, 4.6, 12, "Purple", purple],
  ["grey", "Oversized Grey Tee", 649, 4.7, 16, "Grey", grey],
  ["back-off-white", "Back Print Off-White Tee", 699, 4.7, 14, "Off-White", backWhite],
].map((p, i) => ({
  id: String(p[0]),
  slug: String(p[0]),
  name: String(p[1]),
  price: Number(p[2]),
  rating: Number(p[3]),
  reviews: Number(p[4]),
  colour: String(p[5]),
  image: String(p[6]),
  category: "T-Shirts",
  badge: i === 0 || i === 4 ? "BEST SELLER" : undefined,
}));
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
export const demoOrders: Order[] = ["Delivered", "Shipped", "Processing"].map((status, i) => {
  const product = products[i] ?? products.find((p) => p.id === "black");
  if (!product) throw new Error("Missing sample product");
  return {
    id: `YRT68473${i + 2}`,
    createdAt: `2026-10-${String(6 + i).padStart(2, "0")}T10:30:00Z`,
    status: status as Order["status"],
    items: [{ productId: product.id, colour: product.colour, size: "L", quantity: 1 }],
    ...totals([{ productId: product.id, colour: product.colour, size: "L", quantity: 1 }]),
    paymentMethod: "Cash on Delivery",
  };
});
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
