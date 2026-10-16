import { describe, expect, it } from "vitest";
import { normalizePhone, signupDetailsSchema } from "./phone";

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