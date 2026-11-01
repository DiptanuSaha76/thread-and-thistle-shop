import { describe, expect, it } from "vitest";
import { checkTrackingNumber, isTrackableAwb } from "./awb";
import { isTrackableAwb as lookupAccepts } from "./shiprocket.server";

const ok = (raw: string) => checkTrackingNumber(raw);

describe("admin tracking number check", () => {
  it("accepts AWB numbers and trims surrounding spaces", () => {
    expect(ok("SR1234567890")).toEqual({ ok: true, value: "SR1234567890" });
    expect(ok("  141123221084922 \n")).toEqual({ ok: true, value: "141123221084922" });
    expect(ok("DLV-77881234")).toEqual({ ok: true, value: "DLV-77881234" });
  });
  it("keeps letter case (AWBs are not changed)", () => {
    expect(ok("ab12CD34")).toEqual({ ok: true, value: "ab12CD34" });
  });
  it("an empty field means 'no tracking number'", () => {
    expect(ok("")).toEqual({ ok: true, value: null });
  });
  it.each([
    ["   ", /blank/],
    ["\t\n", /blank/],
    ["https://shiprocket.co/tracking/SR1234567890", /web link/],
    ["shiprocket.co/tracking/SR1234567890", /web link/],
    ["www.shiprocket.co", /web link/],
    ["SR1234567890?ref=mail", /web link/],
    ["javascript:alert(1)", /web link/],
    ["SR 1234 5678", /can't contain spaces/],
    ["will ship tomorrow", /can't contain spaces/],
    ["12345", /6-40 characters/],
    ["A".repeat(41), /6-40 characters/],
    ["SR1234567890✓", /6-40 characters/],
    ["<b>SR123456</b>", /web link|6-40/],
    ["../../orders", /web link/],
  ])("refuses %j", (raw, message) => {
    const result = ok(raw);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(message);
  });
  it("anything the admin can save is something the tracking lookup can use", () => {
    for (const raw of ["SR1234567890", " 141123221084922 ", "DLV-77881234", "ab12CD34"]) {
      const result = ok(raw);
      expect(result.ok && result.value !== null && isTrackableAwb(result.value) && lookupAccepts(result.value)).toBe(true);
    }
  });
});
