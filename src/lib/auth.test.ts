import { describe, expect, it } from "vitest";
import { passwordProblem, safeNext } from "./auth";

describe("account rules", () => {
  it("requires at least 8 characters", () => {
    expect(passwordProblem("abc1234")).not.toBeNull();
  });
  it("requires a letter and a number", () => {
    expect(passwordProblem("abcdefgh")).not.toBeNull();
    expect(passwordProblem("abcdefg1")).toBeNull();
  });
  it("rejects off-site return destinations", () => {
    expect(safeNext("//evil.com")).toBe("/account");
    expect(safeNext("/checkout")).toBe("/checkout");
  });
});