import { describe, expect, it } from "vitest";
import {
  addMessage,
  addToBag,
  inBagAfter,
  lineLimit,
  MAX_LINES,
  MAX_PER_LINE,
  remainingFor,
  setLineQuantity,
} from "./bag";
import { lineKey, type CartLine } from "./catalogue";

const tee = (size: string, quantity = 1, colour = "Black"): CartLine => ({
  productId: "tee",
  colour,
  size,
  quantity,
});

describe("adding the same item again", () => {
  it("adds a new row the first time", () => {
    const { bag, outcome } = addToBag([], tee("M"), 5);
    expect(bag).toEqual([tee("M", 1)]);
    expect(outcome).toEqual({ kind: "added", quantity: 1 });
    expect(addMessage(outcome)).toEqual({ tone: "success", text: "Added to your bag" });
  });

  it("raises the quantity of the same product, colour and size instead of adding a row", () => {
    const { bag, outcome } = addToBag([tee("M", 1)], tee("M"), 5);
    expect(bag).toEqual([tee("M", 2)]);
    expect(outcome).toEqual({ kind: "increased", quantity: 2 });
    expect(addMessage(outcome).text).toMatch(/now have 2 of this item/);
  });

  it("keeps different sizes and colours as separate rows", () => {
    const bag1 = addToBag([tee("M", 1)], tee("L"), 5).bag;
    const bag2 = addToBag(bag1, tee("M", 1, "White"), 5).bag;
    expect(bag2.map(lineKey)).toEqual(["tee|Black|M", "tee|Black|L", "tee|White|M"]);
  });

  it("does not change the bag it was given", () => {
    const original = [tee("M", 1)];
    addToBag(original, tee("M"), 5);
    expect(original).toEqual([tee("M", 1)]);
  });
});

describe("stock limits (the reported bug)", () => {
  it("with only 1 in stock, a second add changes nothing and does NOT say 'Added'", () => {
    const first = addToBag([], tee("M"), 1);
    const second = addToBag(first.bag, tee("M"), 1);
    expect(second.bag).toEqual([tee("M", 1)]);
    expect(second.bag).toBe(first.bag);
    expect(second.outcome).toEqual({ kind: "at_limit", quantity: 1, limit: 1, reason: "stock" });
    const message = addMessage(second.outcome);
    expect(message.tone).not.toBe("success");
    expect(message.text).toBe("You already have the last one in this size in your bag.");
  });

  it("adds only what is left and says so", () => {
    const { bag, outcome } = addToBag([tee("M", 2)], tee("M", 5), 3);
    expect(bag).toEqual([tee("M", 3)]);
    expect(outcome).toEqual({ kind: "limited", quantity: 3, limit: 3, reason: "stock" });
    expect(addMessage(outcome).text).toBe("Only 3 available in this size, so your bag now has 3.");
  });

  it("says when all of the stock is already in the bag", () => {
    const { outcome } = addToBag([tee("M", 5)], tee("M"), 5);
    expect(addMessage(outcome).text).toBe(
      "You already have all 5 available in this size in your bag.",
    );
  });

  it("caps one row at the per-item maximum even with plenty of stock", () => {
    const { bag, outcome } = addToBag([tee("M", 9)], tee("M", 4), 500);
    expect(bag).toEqual([tee("M", MAX_PER_LINE)]);
    expect(outcome).toMatchObject({ kind: "limited", reason: "max" });
    const again = addToBag(bag, tee("M"), 500);
    expect(addMessage(again.outcome).text).toMatch(/maximum of 10/);
  });

  it("refuses out-of-stock items with the existing message", () => {
    for (const stock of [0, -3, Number.NaN]) {
      const { bag, outcome } = addToBag([], tee("M"), stock);
      expect(bag).toEqual([]);
      expect(outcome).toEqual({ kind: "out_of_stock" });
    }
    expect(addMessage({ kind: "out_of_stock" })).toEqual({
      tone: "error",
      text: "This variant is out of stock",
    });
  });

  it("never lowers a row whose stock dropped after it was added", () => {
    const { bag, outcome } = addToBag([tee("M", 4)], tee("M"), 2);
    expect(bag).toEqual([tee("M", 4)]);
    expect(outcome).toMatchObject({ kind: "at_limit", quantity: 4 });
  });

  it("treats odd quantities as 1", () => {
    for (const quantity of [0, -2, Number.NaN, 1.7]) {
      expect(addToBag([], { ...tee("M"), quantity }, 5).bag).toEqual([tee("M", 1)]);
    }
  });

  it("keeps the bag to the row limit", () => {
    const full = Array.from({ length: MAX_LINES }, (_, i) => tee(`S${i}`));
    const { bag, outcome } = addToBag(full, tee("XL"), 5);
    expect(bag).toBe(full);
    expect(outcome).toEqual({ kind: "bag_full" });
    expect(addToBag(full, tee("S3"), 5).outcome).toEqual({ kind: "increased", quantity: 2 });
  });
});

describe("Buy now and Undo ('ensure': at least this many, never doubled)", () => {
  it("does not add a second one when the item is already in the bag", () => {
    const { bag, outcome } = addToBag([tee("M", 1)], tee("M", 1), 5, "ensure");
    expect(bag).toEqual([tee("M", 1)]);
    expect(outcome).toEqual({ kind: "already", quantity: 1 });
    expect(inBagAfter(outcome)).toBe(true);
  });

  it("raises to the requested quantity, within stock", () => {
    expect(addToBag([tee("M", 1)], tee("M", 3), 5, "ensure").bag).toEqual([tee("M", 3)]);
    expect(addToBag([tee("M", 1)], tee("M", 3), 2, "ensure").bag).toEqual([tee("M", 2)]);
  });

  it("puts back exactly what was removed", () => {
    expect(addToBag([], tee("M", 2), 5, "ensure")).toEqual({
      bag: [tee("M", 2)],
      outcome: { kind: "added", quantity: 2 },
    });
  });

  it("tells Buy now whether the item is in the bag", () => {
    expect(inBagAfter({ kind: "out_of_stock" })).toBe(false);
    expect(inBagAfter({ kind: "bag_full" })).toBe(false);
    expect(inBagAfter({ kind: "at_limit", quantity: 1, limit: 1, reason: "stock" })).toBe(true);
  });
});

describe("quantity controls", () => {
  it("keeps a row between 1 and the stock left", () => {
    const bag = [tee("M", 2), tee("L", 1)];
    expect(setLineQuantity(bag, "tee|Black|M", 9, 3)).toEqual([tee("M", 3), tee("L", 1)]);
    expect(setLineQuantity(bag, "tee|Black|M", 0, 3)).toEqual([tee("M", 1), tee("L", 1)]);
    expect(setLineQuantity(bag, "tee|Black|M", 50, 500)[0]?.quantity).toBe(MAX_PER_LINE);
    expect(setLineQuantity(bag, "tee|Black|M", 3, 0)[0]?.quantity).toBe(1);
  });

  it("lets the customer bring a row down after stock dropped", () => {
    expect(setLineQuantity([tee("M", 5)], "tee|Black|M", 4, 3)).toEqual([tee("M", 3)]);
  });

  it("knows how many more can be added on the product page", () => {
    const bag = [tee("M", 2)];
    expect(remainingFor(bag, { productId: "tee", colour: "Black", size: "M" }, 5)).toBe(3);
    expect(remainingFor(bag, { productId: "tee", colour: "Black", size: "M" }, 2)).toBe(0);
    expect(remainingFor(bag, { productId: "tee", colour: "Black", size: "L" }, 50)).toBe(10);
    expect(lineLimit(Number.NaN)).toBe(0);
  });
});
