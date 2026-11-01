import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The service-role client is a fake: no database is used and no email is sent.
const rpc = vi.fn();
const getUser = vi.fn();
vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: { rpc: (...a: unknown[]) => rpc(...a), auth: { getUser: (...a: unknown[]) => getUser(...a) } },
}));
const { contactInput, submitContact, ContactError } = await import("./support.server");

const valid = { name: "Ann Lee", email: "ann@example.com", topic: "My order" as const, message: "Where is my parcel? Order YE1001." };
beforeEach(() => {
  process.env["SUPABASE_SERVICE_ROLE_KEY"] = "service-role-test-key";
  rpc.mockReset().mockResolvedValue({ data: "id-1", error: null });
  getUser.mockReset().mockResolvedValue({ data: { user: null }, error: { message: "bad" } });
});
afterEach(() => {
  delete process.env["SUPABASE_SERVICE_ROLE_KEY"];
  vi.restoreAllMocks();
});

describe("contact form validation", () => {
  it("accepts a normal message and trims it", () => {
    expect(contactInput.parse({ ...valid, name: "  Ann Lee " }).name).toBe("Ann Lee");
  });
  it.each([
    [{ ...valid, name: " " }, /enter your name/],
    [{ ...valid, email: "nope" }, /valid email/],
    [{ ...valid, message: "short" }, /at least 10/],
    [{ ...valid, message: "x".repeat(4001) }, /under 4000/],
  ])("rejects invalid input %#", (input, message) => {
    const result = contactInput.safeParse(input);
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toMatch(message);
  });
  it("only allows the form's topics", () => {
    expect(contactInput.safeParse({ ...valid, topic: "Hack" }).success).toBe(false);
  });
});

describe("submitContact", () => {
  it("saves through the database function with a hashed IP (never the raw IP)", async () => {
    await submitContact(valid, new Headers({ "cf-connecting-ip": "203.0.113.9" }));
    const args = rpc.mock.calls[0]![1] as Record<string, unknown>;
    expect(rpc.mock.calls[0]![0]).toBe("submit_support_message");
    expect(args).toMatchObject({ p_name: "Ann Lee", p_email: "ann@example.com", p_topic: "My order", p_user: null });
    expect(args["p_ip_hash"]).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(args)).not.toContain("203.0.113.9");
  });
  it("links the message to the signed-in customer only when the session is valid", async () => {
    getUser.mockResolvedValue({ data: { user: { id: "user-1" } }, error: null });
    await submitContact(valid, new Headers({ authorization: "Bearer a.b.c" }));
    expect((rpc.mock.calls[0]![1] as Record<string, unknown>)["p_user"]).toBe("user-1");
    getUser.mockResolvedValue({ data: { user: null }, error: { message: "invalid" } });
    await submitContact(valid, new Headers({ authorization: "Bearer x.y.z" }));
    expect((rpc.mock.calls[1]![1] as Record<string, unknown>)["p_user"]).toBeNull();
  });
  it("explains rate limits and hides unexpected database errors", async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { message: "RATE_LIMITED" } });
    await expect(submitContact(valid, undefined)).rejects.toThrow(/several messages recently/);
    vi.spyOn(console, "error").mockImplementation(() => {});
    rpc.mockResolvedValueOnce({ data: null, error: { message: 'relation "support_messages" does not exist' } });
    const failure = submitContact(valid, undefined);
    await expect(failure).rejects.toBeInstanceOf(ContactError);
    await expect(failure).rejects.toThrow("We couldn't send your message right now. Please try again later.");
  });
});
