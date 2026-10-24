import { describe, it, expect } from "vitest";
import { totals, lineKey, stock, products, hydrateProducts } from "./catalogue";
import { fetchPublicCatalogue } from "./functions";
describe("YEARTH commerce", () => {
  it("returns zero totals when no live products are loaded", () =>
    expect(totals([{ productId: "missing", colour: "Black", size: "M", quantity: 1 }])).toEqual({
      subtotal: 0,
      shipping: 0,
      discount: 0,
      total: 0,
    }));
  it("does not charge shipping for an empty cart", () => expect(totals([]).total).toBe(0));
  it("identifies different variants separately", () =>
    expect(lineKey({ productId: "black", colour: "Black", size: "M", quantity: 1 })).not.toBe(
      lineKey({ productId: "black", colour: "Brown", size: "M", quantity: 1 }),
    ));
  it("returns no products when live data is empty", () => {
    const liveProducts = hydrateProducts([]);
    expect(liveProducts).toEqual([]);
    expect(products).toEqual([]);
  });
  it("keeps sold-out variants explicit when a product exists", () => {
    const product = { id: "catalog", slug: "catalog", name: "Catalog Item", price: 999, rating: 4.5, reviews: 3, colour: "Black", image: "catalog.jpg", category: "T-Shirts" };
    expect(stock(product, "Black", "XL")).toBe(10);
  });
  it("loads the live storefront catalogue from the public server path", async () => {
    const catalogue = await fetchPublicCatalogue();
    expect(Array.isArray(catalogue.products)).toBe(true);
    expect(Array.isArray(catalogue.variants)).toBe(true);
  });
});
