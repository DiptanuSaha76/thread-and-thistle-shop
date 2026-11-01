import { describe, expect, it } from "vitest";
import { isValidMobile, normalizePhone, parseInternationalPhone, signupDetailsSchema } from "./phone";

describe("signup mobile numbers", () => {
  it("normalizes India and international numbers", () => {
    expect(normalizePhone("IN", "98765 43210")).toBe("+919876543210");
    expect(normalizePhone("GB", "07700 900123")).toBe("+447700900123");
  });
  it("rejects invalid and overlong numbers", () => {
    expect(normalizePhone("IN", "12345")).toBeNull();
    expect(normalizePhone("IN", "1234567890")).toBeNull();
    expect(normalizePhone("US", "1234567890123456")).toBeNull();
    expect(normalizePhone("IN", "98765<script>")).toBeNull();
  });
  it("validates signup contact information", () => {
    expect(signupDetailsSchema.safeParse({ first: "A", last: "B", email: "invalid", phone: "+919876543210" }).success).toBe(false);
  });
});
describe("per-country mobile rules", () => {
  it("accepts typical mobiles for each offered country", () => {
    expect(normalizePhone("US", "(202) 555-0123")).toBe("+12025550123");
    expect(normalizePhone("CA", "416 555 0199")).toBe("+14165550199");
    expect(normalizePhone("AU", "0412 345 678")).toBe("+61412345678");
    expect(normalizePhone("AE", "050 123 4567")).toBe("+971501234567");
    expect(normalizePhone("SG", "8123 4567")).toBe("+6581234567");
    expect(normalizePhone("DE", "0151 23456789")).toBe("+4915123456789");
    expect(normalizePhone("FR", "06 12 34 56 78")).toBe("+33612345678");
  });
  it("rejects numbers that do not fit the selected country", () => {
    expect(normalizePhone("GB", "020 7946 0018")).toBeNull(); // landline, not mobile
    expect(normalizePhone("US", "123 456 7890")).toBeNull(); // area code cannot start with 1
    expect(normalizePhone("SG", "6123 4567")).toBeNull();
    expect(normalizePhone("XX", "9876543210")).toBeNull();
  });
  it("reads numbers typed with a country code", () => {
    expect(parseInternationalPhone("+44 7700 900123", "IN")).toEqual({ phone: "+447700900123", country: "GB" });
    expect(parseInternationalPhone("98765 43210", "IN")).toEqual({ phone: "+919876543210", country: "IN" });
    expect(parseInternationalPhone("+1 416 555 0199", "CA")).toEqual({ phone: "+14165550199", country: "CA" });
    expect(parseInternationalPhone("+1 416 555 0199", "IN")).toEqual({ phone: "+14165550199", country: "US" });
    expect(parseInternationalPhone("+91 12345", "IN")).toBeNull();
    expect(parseInternationalPhone("call me", "IN")).toBeNull();
  });
  it("checks stored E.164 numbers against their country", () => {
    expect(isValidMobile("+919876543210", "IN")).toBe(true);
    expect(isValidMobile("+919876543210", "US")).toBe(false);
  });
});
