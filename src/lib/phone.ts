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

export function normalizePhone(country: string, value: string) {
  const selected = callingCountries.find((item) => item.iso === country);
  if (!selected || !/^[\d\s()-]+$/.test(value)) return null;
  const local = value.replace(/\D/g, "").replace(/^0+/, "");
  if (selected.iso === "IN" && !/^[6-9]\d{9}$/.test(local)) return null;
  const result = `${selected.dial}${local}`;
  return /^\+[1-9]\d{7,14}$/.test(result) ? result : null;
}

export const signupDetailsSchema = z.object({
  first: z.string().trim().min(1, "Enter your first name").max(100),
  last: z.string().trim().min(1, "Enter your last name").max(100),
  email: z.string().trim().email("Enter a valid email address").max(255),
  phone: z.string().regex(/^\+[1-9]\d{7,14}$/, "Enter a valid mobile number"),
});