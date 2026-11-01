import { describe, expect, it } from "vitest";
import {
  razorpayConfig,
  signaturesMatch,
  verifyCheckoutSignature,
  verifyWebhookSignature,
} from "./razorpay.server";

// Reference values computed independently with:
//   printf 'order_TEST123|pay_TEST456' | openssl dgst -sha256 -hmac 'test_key_secret'
//   printf '{"event":"payment.captured"}' | openssl dgst -sha256 -hmac 'whsec_test'
const CHECKOUT_SIG = "4e29c3db4c2941c4f1b1845d71c004542e3b6439806ce9aeef5e5d9d291c48fe";
const WEBHOOK_SIG = "4f463a57dd128675850163391f0311888616d57bccca75c774c9cdb28134f851";

describe("Razorpay signatures", () => {
  it("accepts a valid checkout signature", () => {
    expect(
      verifyCheckoutSignature("test_key_secret", "order_TEST123", "pay_TEST456", CHECKOUT_SIG),
    ).toBe(true);
  });
  it("rejects a signature for a different payment, order or secret", () => {
    expect(
      verifyCheckoutSignature("test_key_secret", "order_TEST123", "pay_OTHER", CHECKOUT_SIG),
    ).toBe(false);
    expect(
      verifyCheckoutSignature("test_key_secret", "order_OTHER", "pay_TEST456", CHECKOUT_SIG),
    ).toBe(false);
    expect(
      verifyCheckoutSignature("wrong_secret", "order_TEST123", "pay_TEST456", CHECKOUT_SIG),
    ).toBe(false);
  });
  it("rejects tampered or malformed signatures without throwing", () => {
    expect(
      verifyCheckoutSignature(
        "test_key_secret",
        "order_TEST123",
        "pay_TEST456",
        CHECKOUT_SIG.replace(/.$/, "0"),
      ),
    ).toBe(false);
    expect(verifyCheckoutSignature("test_key_secret", "order_TEST123", "pay_TEST456", "")).toBe(
      false,
    );
    expect(signaturesMatch("abc", "abcd")).toBe(false);
  });
  it("verifies webhook bodies byte-for-byte", () => {
    expect(verifyWebhookSignature("whsec_test", '{"event":"payment.captured"}', WEBHOOK_SIG)).toBe(
      true,
    );
    expect(verifyWebhookSignature("whsec_test", '{"event":"payment.captured" }', WEBHOOK_SIG)).toBe(
      false,
    );
  });
});

describe("Razorpay configuration", () => {
  it("is off unless both key id and secret are set", () => {
    expect(razorpayConfig({})).toBeNull();
    expect(razorpayConfig({ RAZORPAY_KEY_ID: "rzp_test_x" })).toBeNull();
    expect(razorpayConfig({ RAZORPAY_KEY_ID: " ", RAZORPAY_KEY_SECRET: "s" })).toBeNull();
    expect(razorpayConfig({ RAZORPAY_KEY_ID: "rzp_test_x", RAZORPAY_KEY_SECRET: "s" })).toEqual({
      keyId: "rzp_test_x",
      keySecret: "s",
      webhookSecret: null,
    });
  });
});
