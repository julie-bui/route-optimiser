import { parsePhoneNumberFromString } from "libphonenumber-js";

export function keepOnlyMobileNumber(phone: string | null | undefined): string | null {
  if (!phone) return null;

  const cleaned = phone.replace(/\(0\)/g, "").trim();

  // Try parsing as-is first (handles numbers with a country code, e.g. +44, +1, +33)
  let parsed = parsePhoneNumberFromString(cleaned);

  // If that fails and it looks like a UK-style number without a country code
  // (e.g. "07123 456789"), retry assuming GB as the default region.
  if (!parsed || !parsed.isValid()) {
    parsed = parsePhoneNumberFromString(cleaned, "GB");
  }

  if (!parsed || !parsed.isValid()) {
    return null;
  }

  const type = parsed.getType();

  // Different libphonenumber number types across countries:
  // MOBILE = definitely a mobile
  // FIXED_LINE_OR_MOBILE = ambiguous (some countries don't distinguish in their numbering plan)
  // Anything else (FIXED_LINE, TOLL_FREE, etc.) = not a personal mobile, exclude it
  if (type === "MOBILE" || type === "FIXED_LINE_OR_MOBILE") {
    return phone;
  }

  return null;
}
