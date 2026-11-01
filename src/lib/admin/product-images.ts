import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Product image uploads (admin product form). Storage permissions are enforced by
 * supabase/migrations/20261028091000_product_images_storage.sql: only admins can
 * upload, overwrite or delete in the `product-images` bucket.
 */
export const PRODUCT_IMAGE_BUCKET = "product-images";
export const PRODUCT_IMAGE_MAX_BYTES = 5_000_000;
/** Same list as the bucket's allowed_mime_types (no SVG). */
export const PRODUCT_IMAGE_TYPES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/avif": "avif",
};

/** Random file name with an extension taken from the file type (never from the file name). */
export function productImagePath(file: { type: string; size: number }, id: string) {
  const ext = PRODUCT_IMAGE_TYPES[file.type];
  if (!ext || file.size <= 0 || file.size > PRODUCT_IMAGE_MAX_BYTES) return null;
  return `${id}.${ext}`;
}

/**
 * The link saved on the product. A normal public link when the bucket serves files
 * publicly (checked once, by requesting the new file); otherwise, for a private bucket,
 * a long-lived signed link as before.
 */
export async function productImageUrl(
  storage: SupabaseClient["storage"],
  path: string,
  fetchImpl: typeof fetch = fetch,
) {
  const bucket = storage.from(PRODUCT_IMAGE_BUCKET);
  const publicUrl = bucket.getPublicUrl(path).data.publicUrl;
  try {
    const response = await fetchImpl(publicUrl, { method: "HEAD", cache: "no-store" });
    if (response.ok) return publicUrl;
  } catch {
    // Not reachable as a public file: fall back to a signed link below.
  }
  const signed = await bucket.createSignedUrl(path, 60 * 60 * 24 * 365 * 10);
  if (signed.error) throw signed.error;
  return signed.data.signedUrl;
}
