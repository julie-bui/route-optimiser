export function keepOnlyMobileNumber(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const digitsOnly = phone.replace(/[^0-9]/g, "");
  const normalized = digitsOnly.startsWith("44")
    ? "0" + digitsOnly.slice(2)
    : digitsOnly;
  return normalized.startsWith("07") ? phone : null;
}
