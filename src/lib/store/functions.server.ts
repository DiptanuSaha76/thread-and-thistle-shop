import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { CatalogueProductRow, CatalogueSettings, CatalogueVariantRow, ShopColour } from "./catalogue";
import type { PublicCatalogue } from "./functions";

function recordOf(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function numberOrNull(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function numberOr(value: unknown, fallback: number): number {
  return numberOrNull(value) ?? fallback;
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

function shopColours(value: unknown): ShopColour[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item): ShopColour[] => {
    const row = recordOf(item);
    const name = stringOrNull(row["name"]);
    const hex = stringOrNull(row["hex"]);
    return name && hex ? [{ name, hex }] : [];
  });
}

function normalizeProduct(value: unknown): CatalogueProductRow | null {
  const row = recordOf(value);
  const id = stringOrNull(row["id"]);
  const name = stringOrNull(row["name"]);
  if (!id || !name) return null;

  const imagesValue = row["images"];
  return {
    id,
    slug: stringOrNull(row["slug"]),
    name,
    price: numberOrNull(row["price"]),
    rating: numberOrNull(row["rating"]),
    review_count: numberOrNull(row["review_count"]),
    reviews: numberOrNull(row["reviews"]),
    primary_colour: stringOrNull(row["primary_colour"]),
    colour: stringOrNull(row["colour"]),
    image_key: stringOrNull(row["image_key"]),
    image_url: stringOrNull(row["image_url"]),
    images: Array.isArray(imagesValue) ? stringArray(imagesValue) : null,
    category: stringOrNull(row["category"]),
    badge: stringOrNull(row["badge"]),
    description: stringOrNull(row["description"]),
    compare_at_price: numberOrNull(row["compare_at_price"]),
  };
}

function normalizeVariant(value: unknown): CatalogueVariantRow | null {
  const row = recordOf(value);
  const id = stringOrNull(row["id"]);
  const productId = stringOrNull(row["product_id"]);
  const colour = stringOrNull(row["colour"]);
  const size = stringOrNull(row["size"]);
  if (!id || !productId || !colour || !size) return null;

  return {
    id,
    product_id: productId,
    colour,
    colour_hex: stringOrNull(row["colour_hex"]),
    size,
    stock: numberOr(row["stock"], 0),
    image_url: stringOrNull(row["image_url"]),
  };
}

function normalizeSettings(value: unknown): CatalogueSettings | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = recordOf(value);
  return {
    categories: stringArray(row["categories"]),
    colours: shopColours(row["colours"]),
    price_min: numberOr(row["price_min"], 249),
    price_max: numberOr(row["price_max"], 1499),
    filters: stringArray(row["filters"]),
    free_shipping_threshold: numberOr(row["free_shipping_threshold"], 999),
    shipping_fee: numberOr(row["shipping_fee"], 79),
    sizes: stringArray(row["sizes"]),
  };
}

export async function fetchPublicCatalogue(): Promise<PublicCatalogue> {
  const [productResult, variantResult, settingsResult] = await Promise.all([
    supabaseAdmin.from("products").select("*").eq("active", true).order("sort_order"),
    supabaseAdmin.from("product_variants").select("*"),
    supabaseAdmin.from("store_settings").select("*").eq("id", 1).maybeSingle(),
  ]);

  if (productResult.error || variantResult.error) {
    // Detailed errors stay in the server terminal; never send sensitive details to storefront users.
    console.error("[YEARTH] Public catalogue query failed", {
      products: productResult.error?.message,
      variants: variantResult.error?.message,
    });
    throw new Error("Unable to load the store catalogue. Check the server terminal for details.");
  }

  if (settingsResult.error) {
    console.warn("[YEARTH] Store settings could not be loaded:", settingsResult.error.message);
  }

  const products = (productResult.data ?? [])
    .map((row) => normalizeProduct(row))
    .filter((row): row is CatalogueProductRow => row !== null);
  const variants = (variantResult.data ?? [])
    .map((row) => normalizeVariant(row))
    .filter((row): row is CatalogueVariantRow => row !== null);

  return {
    products,
    variants,
    settings: settingsResult.error ? null : normalizeSettings(settingsResult.data),
  };
}
