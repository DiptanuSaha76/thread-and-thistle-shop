/**
 * Rules for adding to the bag. Pure functions (no React, no database), so every place that adds
 * to the bag - the product page, Buy now, Undo and "Buy again" - behaves the same and is testable.
 *
 * - The same product, colour and size is one row; adding it again raises that row's quantity.
 * - A row never goes above the stock available or MAX_PER_LINE, and the customer is told when
 *   that limit stopped an add (the old code always said "Added to your bag").
 * - The order itself is still checked against live stock by the database at checkout.
 */
import { lineKey, type CartLine } from "./catalogue";

/** Most pieces of one product/colour/size in one order. */
export const MAX_PER_LINE = 10;
/** Most different rows in the bag (the saved bag is limited to this too). */
export const MAX_LINES = 50;

/** "add": add the requested quantity. "ensure": make sure at least that many are in the bag. */
export type AddMode = "add" | "ensure";

export type LimitReason = "stock" | "max";

export type AddOutcome =
  /** A new row with the full requested quantity. */
  | { kind: "added"; quantity: number }
  /** The existing row went up to `quantity`. */
  | { kind: "increased"; quantity: number }
  /** Some were added, but fewer than asked because of the limit. */
  | { kind: "limited"; quantity: number; limit: number; reason: LimitReason }
  /** Nothing added: the row is already at the limit. */
  | { kind: "at_limit"; quantity: number; limit: number; reason: LimitReason }
  /** "ensure": the bag already holds at least the requested quantity. */
  | { kind: "already"; quantity: number }
  | { kind: "out_of_stock" }
  | { kind: "bag_full" };

const whole = (n: unknown, fallback: number) =>
  typeof n === "number" && Number.isFinite(n) ? Math.floor(n) : fallback;

/** Highest quantity allowed for one row with `available` in stock. */
export function lineLimit(available: number) {
  return Math.max(0, Math.min(MAX_PER_LINE, whole(available, 0)));
}

/** The bag after adding `line`, and what happened. Never mutates `bag`. */
export function addToBag(
  bag: CartLine[],
  line: CartLine,
  available: number,
  mode: AddMode = "add",
): { bag: CartLine[]; outcome: AddOutcome } {
  const stockLeft = Math.max(0, whole(available, 0));
  if (stockLeft === 0) return { bag, outcome: { kind: "out_of_stock" } };
  const limit = lineLimit(stockLeft);
  const reason: LimitReason = stockLeft < MAX_PER_LINE ? "stock" : "max";
  const requested = Math.max(1, whole(line.quantity, 1));
  const key = lineKey(line);
  const existing = bag.find((l) => lineKey(l) === key);
  const current = existing?.quantity ?? 0;

  if (!existing && bag.length >= MAX_LINES) return { bag, outcome: { kind: "bag_full" } };
  if (mode === "ensure" && current >= requested)
    return { bag, outcome: { kind: "already", quantity: current } };

  const wanted = mode === "add" ? current + requested : requested;
  const next = Math.min(limit, wanted);
  // Already at (or, after a stock drop, above) the limit: change nothing here; the bag page
  // shows the stock note and checkout re-checks stock.
  if (next <= current)
    return { bag, outcome: { kind: "at_limit", quantity: current, limit, reason } };

  const row: CartLine = {
    productId: line.productId,
    colour: line.colour,
    size: line.size,
    quantity: next,
  };
  const nextBag = existing ? bag.map((l) => (lineKey(l) === key ? row : l)) : [...bag, row];
  const outcome: AddOutcome =
    next < wanted
      ? { kind: "limited", quantity: next, limit, reason }
      : existing
        ? { kind: "increased", quantity: next }
        : { kind: "added", quantity: next };
  return { bag: nextBag, outcome };
}

/** The bag with one row's quantity set to `n`, kept between 1 and what stock allows. */
export function setLineQuantity(bag: CartLine[], key: string, n: number, available: number) {
  const upper = Math.max(1, lineLimit(available));
  const quantity = Math.max(1, Math.min(upper, whole(n, 1)));
  return bag.map((l) => (lineKey(l) === key && l.quantity !== quantity ? { ...l, quantity } : l));
}

/** How many more of this row the customer can still add (0 when the bag holds the limit). */
export function remainingFor(bag: CartLine[], line: Omit<CartLine, "quantity">, available: number) {
  const inBag = bag.find((l) => lineKey(l) === lineKey({ ...line, quantity: 0 }))?.quantity ?? 0;
  return Math.max(0, lineLimit(available) - inBag);
}

export type BagMessage = { tone: "success" | "info" | "error"; text: string };

/** What to tell the customer after an add. */
export function addMessage(outcome: AddOutcome): BagMessage {
  switch (outcome.kind) {
    case "added":
      return { tone: "success", text: "Added to your bag" };
    case "increased":
      return {
        tone: "success",
        text: `Added. You now have ${outcome.quantity} of this item in your bag.`,
      };
    case "limited":
      return {
        tone: "info",
        text:
          outcome.reason === "stock"
            ? `Only ${outcome.limit} available in this size, so your bag now has ${outcome.quantity}.`
            : `You can buy up to ${MAX_PER_LINE} of each item, so your bag now has ${outcome.quantity}.`,
      };
    case "at_limit":
      return {
        tone: "info",
        text:
          outcome.reason === "max"
            ? `You already have the maximum of ${MAX_PER_LINE} of this item in your bag.`
            : outcome.limit === 1
              ? "You already have the last one in this size in your bag."
              : `You already have all ${outcome.limit} available in this size in your bag.`,
      };
    case "already":
      return { tone: "info", text: "This item is already in your bag." };
    case "out_of_stock":
      return { tone: "error", text: "This variant is out of stock" };
    case "bag_full":
      return {
        tone: "error",
        text: `Your bag can hold up to ${MAX_LINES} different items. Remove one to add another.`,
      };
  }
}

/** True when the item is in the bag after the add (so "Buy now" can continue to checkout). */
export const inBagAfter = (outcome: AddOutcome) =>
  outcome.kind !== "out_of_stock" && outcome.kind !== "bag_full";
