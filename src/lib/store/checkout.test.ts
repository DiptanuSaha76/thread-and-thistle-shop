import { afterEach, describe, expect, it, vi } from "vitest";
import { products, totals, type Product } from "./catalogue";
import { mergeCarts, sanitizeCart, toOrder } from "./orders";
import { dbErrorKey, isNetworkFailure, orderErrorMessage, profileErrorMessage } from "./errors";

const tee: Product = {
  id: "p1",
  slug: "tee",
  name: "Tee",
  price: 799,
  rating: 0,
  reviews: 0,
  colour: "Black",
  image: "",
  category: "T-Shirts",
};

afterEach(() => {
  products.splice(0, products.length);
  vi.unstubAllGlobals();
});

describe("display totals", () => {
  it("matches the database formula (subtotal + shipping − rounded discount)", () => {
    products.push(tee);
    expect(totals([{ productId: "p1", colour: "Black", size: "M", quantity: 2 }], 10)).toEqual({
      subtotal: 1598,
      shipping: 0,
      discount: 160,
      total: 1438,
    });
    expect(totals([{ productId: "p1", colour: "Black", size: "M", quantity: 1 }], 0)).toEqual({
      subtotal: 799,
      shipping: 79,
      discount: 0,
      total: 878,
    });
  });
  it("ignores impossible discount values", () => {
    products.push(tee);
    expect(
      totals([{ productId: "p1", colour: "Black", size: "M", quantity: 1 }], 150).discount,
    ).toBe(0);
    expect(
      totals([{ productId: "p1", colour: "Black", size: "M", quantity: 1 }], -5).discount,
    ).toBe(0);
  });
});

describe("saved bag", () => {
  it("keeps only valid lines for known products, max 10 each", () => {
    products.push(tee);
    expect(
      sanitizeCart([
        { productId: "p1", colour: "Black", size: "M", quantity: 25 },
        { productId: "gone", colour: "Black", size: "M", quantity: 1 },
        { productId: "p1", colour: "Black", size: "L", quantity: 0 },
        { productId: "p1", colour: "Black", size: "S", quantity: "2" },
        null,
        "junk",
      ]),
    ).toEqual([{ productId: "p1", colour: "Black", size: "M", quantity: 10 }]);
    expect(sanitizeCart({ not: "an array" })).toEqual([]);
  });
  it("merges account and browser bags without doubling quantities", () => {
    const saved = [{ productId: "p1", colour: "Black", size: "M", quantity: 2 }];
    const local = [
      { productId: "p1", colour: "Black", size: "M", quantity: 3 },
      { productId: "p1", colour: "Black", size: "L", quantity: 1 },
    ];
    expect(mergeCarts(saved, local)).toEqual([
      { productId: "p1", colour: "Black", size: "M", quantity: 3 },
      { productId: "p1", colour: "Black", size: "L", quantity: 1 },
    ]);
  });
});

describe("order display", () => {
  const row = {
    id: "uuid",
    order_number: "YE1001",
    created_at: "2026-10-27T10:00:00Z",
    status: "Processing",
    subtotal: 1598,
    shipping: 0,
    discount: 160,
    total: 1438,
    payment_method: "razorpay",
    payment_status: "pending",
    tracking_number: null,
    ship_name: "A",
    ship_phone: "+919876543210",
    ship_address: "1 Road",
    ship_city: "B",
    ship_state: "C",
    ship_pincode: "560001",
    order_items: [{ product_id: "p1", colour: "Black", size: "M", quantity: 2 }],
  };
  it("shows unpaid online orders as awaiting payment", () => {
    expect(toOrder(row).status).toBe("Awaiting payment");
    expect(toOrder(row).paymentMethod).toBe("Online payment (not confirmed yet)");
  });
  it("shows paid online orders and COD orders as processing", () => {
    expect(toOrder({ ...row, payment_status: "paid" }).status).toBe("Processing");
    expect(toOrder({ ...row, payment_method: "cod" }).status).toBe("Processing");
    expect(toOrder({ ...row, payment_method: "cod" }).paymentMethod).toBe("Cash on Delivery");
  });
  it("turns amounts stored as text into numbers", () => {
    const order = toOrder({
      ...row,
      subtotal: "1598",
      shipping: "0",
      discount: "160",
      total: "1438",
      order_items: [{ product_id: "p1", colour: "Black", size: "M", quantity: "2" }],
    });
    expect(order).toMatchObject({ subtotal: 1598, shipping: 0, discount: 160, total: 1438 });
    expect(order.items[0]?.quantity).toBe(2);
    expect(order.items.reduce((n, l) => n + l.quantity, 0)).toBe(2);
  });
});

describe("database error messages", () => {
  it("explains stock problems with the item name", () => {
    expect(
      orderErrorMessage({ message: "OUT_OF_STOCK", details: "Tee (Black / L)", hint: "1" }),
    ).toBe("Only 1 left of Tee (Black / L). Please update your bag.");
    expect(
      orderErrorMessage({ message: "OUT_OF_STOCK", details: "Tee (Black / L)", hint: "0" }),
    ).toBe("Tee (Black / L) is out of stock. Please remove it from your bag.");
  });
  it("never shows raw database text", () => {
    const raw = {
      message: 'duplicate key value violates unique constraint "orders_pkey"',
      code: "23505",
    };
    expect(orderErrorMessage(raw)).toBe("Something went wrong with your order. Please try again.");
    expect(dbErrorKey(raw)).toBeNull();
    expect(profileErrorMessage({ message: "permission denied for table profiles" })).toBe(
      "Your details could not be saved. Please try again.",
    );
  });
  it("recognises network failures", () => {
    expect(isNetworkFailure({ message: "TypeError: Failed to fetch" })).toBe(true);
    expect(orderErrorMessage({ message: "TypeError: Failed to fetch" })).toMatch(
      /couldn't connect/,
    );
    vi.stubGlobal("navigator", { onLine: false });
    expect(isNetworkFailure({ message: "anything" })).toBe(true);
  });
  it("maps profile reasons to field messages", () => {
    expect(profileErrorMessage({ message: "INVALID_PHONE" })).toBe(
      "Enter a valid mobile number for the selected country",
    );
  });
});
