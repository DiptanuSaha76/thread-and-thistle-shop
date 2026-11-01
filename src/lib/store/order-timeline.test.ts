import { describe, expect, it } from "vitest";
import { orderTimeline, toOrder, ORDER_COLUMNS, type OrderRow } from "./orders";

const placed = "2026-10-20T10:00:00.000Z";
const view = (steps: ReturnType<typeof orderTimeline>) => steps.map((s) => [s.label, s.done, s.at, s.note]);

describe("order timeline (recorded data only)", () => {
  it("a new order shows only the real order time", () => {
    expect(view(orderTimeline({ status: "Processing", createdAt: placed }))).toEqual([
      ["Order Placed", true, placed, ""],
      ["Processed", false, null, "—"],
      ["Shipped", false, null, "—"],
      ["Delivered", false, null, "—"],
    ]);
  });
  it("uses the recorded shipped and delivered times", () => {
    const steps = orderTimeline({ status: "Delivered", createdAt: placed, shippedAt: "2026-10-22T09:00:00Z", deliveredAt: "2026-10-25T15:30:00Z" });
    expect(view(steps)).toEqual([
      ["Order Placed", true, placed, ""],
      ["Processed", true, null, "Done"],
      ["Shipped", true, "2026-10-22T09:00:00Z", "Date not recorded"],
      ["Delivered", true, "2026-10-25T15:30:00Z", "Date not recorded"],
    ]);
  });
  it("older orders without recorded times say so instead of inventing dates", () => {
    const steps = orderTimeline({ status: "Delivered", createdAt: placed, shippedAt: null, deliveredAt: null });
    expect(steps.filter((s) => s.label !== "Order Placed").every((s) => s.at === null)).toBe(true);
    expect(steps.find((s) => s.label === "Shipped")?.note).toBe("Date not recorded");
    expect(steps.find((s) => s.label === "Delivered")?.note).toBe("Date not recorded");
  });
  it("never shows a date for a step that has not happened, even if one is present", () => {
    const steps = orderTimeline({ status: "Shipped", createdAt: placed, shippedAt: "2026-10-22T09:00:00Z", deliveredAt: "2026-10-23T09:00:00Z" });
    expect(steps.find((s) => s.label === "Delivered")).toMatchObject({ done: false, at: null, note: "—" });
  });
  it("cancelled and awaiting-payment orders only show the order time", () => {
    for (const status of ["Cancelled", "Awaiting payment"] as const) {
      expect(orderTimeline({ status, createdAt: placed, shippedAt: "2026-10-22T09:00:00Z" }).filter((s) => s.at)).toHaveLength(1);
    }
  });
  it("no step is ever the order time plus a number of days", () => {
    const steps = orderTimeline({ status: "Delivered", createdAt: placed, shippedAt: null, deliveredAt: null });
    for (const days of [1, 2, 3]) {
      const guess = new Date(new Date(placed).getTime() + days * 86400000).toISOString();
      expect(steps.some((s) => s.at === guess)).toBe(false);
    }
  });
});

describe("order rows", () => {
  it("reads the recorded times from the database columns", () => {
    expect(ORDER_COLUMNS).toContain("shipped_at");
    expect(ORDER_COLUMNS).toContain("delivered_at");
    const row = {
      id: "o1", order_number: "YE1", created_at: placed, status: "Shipped", subtotal: 1, shipping: 0, discount: 0, total: 1,
      payment_method: "cod", payment_status: "pending", tracking_number: "SR1234567890", shipped_at: "2026-10-22T09:00:00Z", delivered_at: null,
      ship_name: "A", ship_phone: "1", ship_address: "x", ship_city: "y", ship_state: "z", ship_pincode: "411001", order_items: [],
    } satisfies OrderRow;
    expect(toOrder(row)).toMatchObject({ shippedAt: "2026-10-22T09:00:00Z", deliveredAt: null, status: "Shipped" });
  });
});
