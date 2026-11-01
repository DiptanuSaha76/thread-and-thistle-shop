import { z } from "zod";

export const callingCountries = [
  { iso: "IN", name: "India", flag: "🇮🇳", dial: "+91" },
  { iso: "US", name: "United States", flag: "🇺🇸", dial: "+1" },
  { iso: "CA", name: "Canada", flag: "🇨🇦", dial: "+1" },
  { iso: "GB", name: "United Kingdom", flag: "🇬🇧", dial: "+44" },
  { iso: "AU", name: "Australia", flag: "🇦🇺", dial: "+61" },
  { iso: "AE", name: "United Arab Emirates", flag: "🇦🇪", dial: "+971" },
  { iso: "SG", name: "Singapore", flag: "🇸🇬", dial: "+65" },
  { iso: "DE", name: "Germany", flag: "🇩🇪", dial: "+49" },
  { iso: "FR", name: "France", flag: "🇫🇷", dial: "+33" },
] as const;

export type CountryIso = (typeof callingCountries)[number]["iso"];

/**
 * Mobile numbers (national part, without the trunk "0") per country.
 * Keep in sync with public.is_valid_mobile() in
 * supabase/migrations/20261028090000_customer_profiles.sql.
 */
const mobilePatterns: Record<CountryIso, RegExp> = {
  IN: /^[6-9]\d{9}$/,
  US: /^[2-9]\d{2}[2-9]\d{6}$/,
  CA: /^[2-9]\d{2}[2-9]\d{6}$/,
  GB: /^7\d{9}$/,
  AU: /^4\d{8}$/,
  AE: /^5\d{8}$/,
  SG: /^[89]\d{7}$/,
  DE: /^1[5-7]\d{8,9}$/,
  FR: /^[67]\d{8}$/,
};

const isCountry = (value: string): value is CountryIso =>
  callingCountries.some((item) => item.iso === value);

/** Local number typed next to a selected country -> E.164 (e.g. +919876543210), or null. */
export function normalizePhone(country: string, value: string) {
  if (!isCountry(country) || !/^[\d\s()-]+$/.test(value)) return null;
  const selected = callingCountries.find((item) => item.iso === country)!;
  const local = value.replace(/\D/g, "").replace(/^0+/, "");
  if (!mobilePatterns[country].test(local)) return null;
  const result = `${selected.dial}${local}`;
  return /^\+[1-9]\d{7,14}$/.test(result) ? result : null;
}

/** True when an E.164 number is a valid mobile for the given country. */
export function isValidMobile(e164: string, country: string) {
  if (!isCountry(country)) return false;
  const dial = callingCountries.find((item) => item.iso === country)!.dial;
  return e164.startsWith(dial) && mobilePatterns[country].test(e164.slice(dial.length));
}

/**
 * Reads a number typed in one box, e.g. "+44 7700 900123" or "98765 43210".
 * With a leading "+" the country is taken from the calling code (preferring
 * `fallbackCountry` when several countries share a code, like +1); without it
 * the number is read as a local number for `fallbackCountry`.
 */
export function parseInternationalPhone(value: string, fallbackCountry: string) {
  const trimmed = value.trim();
  if (!/^\+?[\d\s()-]+$/.test(trimmed)) return null;
  if (!trimmed.startsWith("+")) {
    const phone = normalizePhone(fallbackCountry, trimmed);
    return phone ? { phone, country: fallbackCountry as CountryIso } : null;
  }
  const digits = `+${trimmed.replace(/\D/g, "")}`;
  const candidates = callingCountries
    .filter((item) => digits.startsWith(item.dial))
    .sort((a, b) => Number(b.iso === fallbackCountry) - Number(a.iso === fallbackCountry));
  for (const item of candidates) {
    if (isValidMobile(digits, item.iso)) return { phone: digits, country: item.iso };
  }
  return null;
}

export const signupDetailsSchema = z.object({
  first: z.string().trim().min(1, "Enter your first name").max(100),
  last: z.string().trim().min(1, "Enter your last name").max(100),
  email: z.string().trim().email("Enter a valid email address").max(255),
  phone: z.string().regex(/^\+[1-9]\d{7,14}$/, "Enter a valid mobile number"),
});
