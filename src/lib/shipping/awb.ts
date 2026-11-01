/**
 * Tracking numbers (AWB) entered by the admin. Shared by the admin form (instant
 * feedback), the admin save function (authoritative) and the Shiprocket lookup, so
 * all three accept exactly the same values.
 *
 * Shiprocket does not document an AWB format (it differs per courier). The rule here
 * is the one the existing tracking lookup already relies on: 6-40 letters, digits or
 * hyphens, which is also safe to place in Shiprocket's /courier/track/awb/{awb} path.
 * It rejects links, spaces and free text; it cannot confirm the AWB exists.
 */
export const AWB_PATTERN = /^[A-Za-z0-9-]{6,40}$/;

export const isTrackableAwb = (value: string | null | undefined): value is string =>
  !!value && AWB_PATTERN.test(value.trim());

export type TrackingNumberCheck =
  | { ok: true; value: string | null }
  | { ok: false; message: string };

/**
 * Normalises what the admin typed. An empty field means "no tracking number" (null).
 * Surrounding spaces are removed; anything else that is not an AWB is refused with a reason.
 */
export function checkTrackingNumber(raw: string): TrackingNumberCheck {
  if (raw === "") return { ok: true, value: null };
  const value = raw.trim();
  if (!value)
    return {
      ok: false,
      message: "The tracking number is blank. Enter the AWB from Shiprocket, or clear the field.",
    };
  if (/^[a-z][a-z0-9+.-]*:|^www\.|[/?#=]/i.test(value))
    return {
      ok: false,
      message:
        "This looks like a web link. Paste only the AWB number from Shiprocket, not the tracking page address.",
    };
  if (/\s/.test(value))
    return { ok: false, message: "The tracking number can't contain spaces. Paste only the AWB number." };
  if (!AWB_PATTERN.test(value))
    return {
      ok: false,
      message: "Enter only the AWB number: 6-40 characters, using letters, digits or hyphens.",
    };
  return { ok: true, value };
}
