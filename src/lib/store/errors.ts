/**
 * Turns errors from Supabase database calls into messages that are safe to show
 * customers. The database functions in supabase/migrations raise short codes
 * such as OUT_OF_STOCK as the error message; anything else gets a generic text.
 */

export const NETWORK_MESSAGE = "We couldn't connect. Check your internet connection and try again.";

type DbErrorLike = { message?: unknown; details?: unknown; hint?: unknown; code?: unknown };

const asError = (error: unknown): DbErrorLike =>
  error && typeof error === "object" ? (error as DbErrorLike) : {};

/** The short code raised by our database functions (e.g. "OUT_OF_STOCK"), if any. */
export function dbErrorKey(error: unknown): string | null {
  const message = asError(error).message;
  return typeof message === "string" && /^[A-Z][A-Z_]{2,40}$/.test(message) ? message : null;
}

/** Errors that mean the request never reached the database. */
export function isNetworkFailure(error: unknown) {
  if (typeof navigator !== "undefined" && navigator.onLine === false) return true;
  const message = asError(error).message;
  return (
    typeof message === "string" &&
    /failed to fetch|networkerror|load failed|network request failed|fetch failed/i.test(message)
  );
}

const text = (value: unknown) => (typeof value === "string" ? value : "");

/** Customer-facing message for order creation and cancellation failures. */
export function orderErrorMessage(error: unknown): string {
  if (isNetworkFailure(error)) return NETWORK_MESSAGE;
  const e = asError(error);
  const item = text(e.details) || "An item";
  switch (dbErrorKey(error)) {
    case "AUTH_REQUIRED":
      return "Please sign in to continue.";
    case "PROFILE_INCOMPLETE":
      return "Please add your name and mobile number to your account before ordering.";
    case "STORE_NOT_CONFIGURED":
      return "Checkout isn't available right now. Please try again later.";
    case "PAYMENT_METHOD_UNAVAILABLE":
      return "That payment method isn't available right now. Please choose another one.";
    case "INVALID_ADDRESS":
      return "Please check your delivery address, phone number and pincode.";
    case "INVALID_ITEMS":
      return "Some items in your bag can't be ordered as they are (up to 10 of each item). Please review your bag.";
    case "PRODUCT_UNAVAILABLE":
      return `${item} is no longer available. Please remove it from your bag.`;
    case "OUT_OF_STOCK": {
      const left = Number.parseInt(text(e.hint), 10);
      return left > 0
        ? `Only ${left} left of ${item}. Please update your bag.`
        : `${item} is out of stock. Please remove it from your bag.`;
    }
    case "INVALID_PROMO":
      return "Your promo code is no longer valid. Remove it from your bag to continue.";
    case "ORDER_NOT_FOUND":
      return "We couldn't find that order.";
    case "ORDER_NOT_CANCELLABLE":
      return "This order can no longer be cancelled.";
    case "ORDER_ALREADY_PAID":
      return "This order has been paid. Please contact us to cancel it and arrange a refund.";
    default:
      return "Something went wrong with your order. Please try again.";
  }
}

/** Customer-facing message for profile saves (account page and profile completion). */
export function profileErrorMessage(error: unknown): string {
  if (isNetworkFailure(error)) return NETWORK_MESSAGE;
  switch (dbErrorKey(error)) {
    case "AUTH_REQUIRED":
      return "Please sign in again to update your details.";
    case "INVALID_FIRST_NAME":
      return "Enter a valid first name using letters, spaces, hyphens or apostrophes";
    case "INVALID_LAST_NAME":
      return "Enter a valid last name using letters, spaces, hyphens or apostrophes";
    case "INVALID_NAME":
      return "Enter a valid name using letters, spaces, hyphens or apostrophes";
    case "INVALID_PHONE":
      return "Enter a valid mobile number for the selected country";
    default:
      return "Your details could not be saved. Please try again.";
  }
}

/** Generic message for other account data (addresses, preferences). */
export function accountErrorMessage(error: unknown, action: string): string {
  if (isNetworkFailure(error)) return NETWORK_MESSAGE;
  if (dbErrorKey(error) === "ADDRESS_NOT_FOUND") return "That address no longer exists.";
  return `${action} failed. Please try again.`;
}
