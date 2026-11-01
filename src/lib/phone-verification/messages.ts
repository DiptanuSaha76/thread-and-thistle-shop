/** Customer-facing wording for mobile verification results (shared by the page and tests). */

/** Numbers outside the countries SMS can be sent to (OneAPI: India). */
export const SMS_COUNTRY_MESSAGE =
  "SMS verification is currently available for Indian (+91) mobile numbers only.";

/** SMS sending is not configured on the server; the server log names what is missing. */
export const SMS_UNAVAILABLE_MESSAGE =
  "Mobile verification isn't available right now, so we can't finish setting up your account. Please try again later.";

export type SendOutcome =
  | { status: "sent"; resendIn: number; expiresIn: number; phoneMasked: string }
  | { status: "cooldown"; resendIn: number }
  | { status: "rate_limited"; retryAfter: number }
  | { status: "already_verified" };

export type VerifyOutcome =
  | { status: "verified" }
  | { status: "incorrect"; attemptsLeft: number }
  | { status: "locked" }
  | { status: "expired" }
  | { status: "no_code" };

const minutes = (seconds: number) => Math.max(1, Math.ceil(seconds / 60));

export function sendOutcomeMessage(outcome: SendOutcome): string {
  switch (outcome.status) {
    case "sent":
      return `We’ve sent a 6-digit code to ${outcome.phoneMasked}.`;
    case "cooldown":
      return `Please wait ${outcome.resendIn} seconds before requesting another code.`;
    case "rate_limited":
      return `You’ve requested too many codes. Please try again in about ${minutes(outcome.retryAfter)} minute${minutes(outcome.retryAfter) === 1 ? "" : "s"}.`;
    case "already_verified":
      return "Your mobile number is already verified.";
  }
}

/** Returns null when the code was accepted. */
export function verifyOutcomeMessage(outcome: VerifyOutcome): string | null {
  switch (outcome.status) {
    case "verified":
      return null;
    case "incorrect":
      return outcome.attemptsLeft > 0
        ? `That code is incorrect. ${outcome.attemptsLeft} attempt${outcome.attemptsLeft === 1 ? "" : "s"} left.`
        : "That code is incorrect. Please request a new code.";
    case "locked":
      return "Too many incorrect attempts. Please request a new code.";
    case "expired":
      return "That code has expired. Please request a new code.";
    case "no_code":
      return "Please request a new code to continue.";
  }
}
