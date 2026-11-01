import { describe, expect, it, vi } from "vitest";
import { productImagePath, productImageUrl } from "./product-images";

const ID = "11111111-1111-4111-8111-111111111111";

describe("productImagePath", () => {
  it("uses a random name and an extension from the file type, not the file name", () => {
    expect(productImagePath({ type: "image/png", size: 1000 }, ID)).toBe(`${ID}.png`);
    expect(productImagePath({ type: "image/jpeg", size: 1000 }, ID)).toBe(`${ID}.jpg`);
  });
  it("refuses SVG, non-images, empty and oversized files", () => {
    expect(productImagePath({ type: "image/svg+xml", size: 1000 }, ID)).toBeNull();
    expect(productImagePath({ type: "text/html", size: 1000 }, ID)).toBeNull();
    expect(productImagePath({ type: "image/png", size: 0 }, ID)).toBeNull();
    expect(productImagePath({ type: "image/png", size: 5_000_001 }, ID)).toBeNull();
  });
});

describe("productImageUrl", () => {
  const storage = (signed = { data: { signedUrl: "https://x.supabase.co/storage/v1/object/sign/product-images/a.png?token=t" }, error: null }) => {
    const createSignedUrl = vi.fn(async () => signed);
    const from = vi.fn(() => ({
      getPublicUrl: (p: string) => ({ data: { publicUrl: `https://x.supabase.co/storage/v1/object/public/product-images/${p}` } }),
      createSignedUrl,
    }));
    return { storage: { from } as never, from, createSignedUrl };
  };
  it("saves a normal public link when the bucket is public", async () => {
    const s = storage();
    const head = vi.fn(async () => new Response(null, { status: 200 }));
    expect(await productImageUrl(s.storage, "a.png", head as never)).toBe("https://x.supabase.co/storage/v1/object/public/product-images/a.png");
    expect(s.from).toHaveBeenCalledWith("product-images");
    expect(s.createSignedUrl).not.toHaveBeenCalled();
  });
  it("falls back to a signed link when the bucket is private or unreachable", async () => {
    const s = storage();
    expect(await productImageUrl(s.storage, "a.png", vi.fn(async () => new Response(null, { status: 400 })) as never)).toContain("/object/sign/");
    expect(await productImageUrl(s.storage, "a.png", vi.fn(async () => { throw new TypeError("offline"); }) as never)).toContain("/object/sign/");
  });
  it("reports a signing failure instead of saving a broken link", async () => {
    const s = storage({ data: null, error: new Error("denied") } as never);
    await expect(productImageUrl(s.storage, "a.png", vi.fn(async () => new Response(null, { status: 400 })) as never)).rejects.toThrow("denied");
  });
});
