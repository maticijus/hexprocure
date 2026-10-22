const ISO_4217 = /^[A-Z]{3}$/;

export const SUPPORTED_CURRENCIES = ["EUR", "USD", "GBP", "CZK", "PLN", "CHF"] as const;

export function isIsoCurrency(code: string): boolean {
  return ISO_4217.test(code);
}

export function formatMoney(minor: number, currency: string, locale = "en-US"): string {
  if (!Number.isInteger(minor)) throw new RangeError("minor units must be an integer");
  if (!isIsoCurrency(currency)) throw new RangeError(`invalid ISO 4217 currency: ${currency}`);
  const formatter = new Intl.NumberFormat(locale, { style: "currency", currency });
  const digits = formatter.resolvedOptions().maximumFractionDigits ?? 2;
  return formatter.format(minor / 10 ** digits);
}

export function toMinorUnits(major: number, currency: string): number {
  const digits = new Intl.NumberFormat("en-US", { style: "currency", currency }).resolvedOptions()
    .maximumFractionDigits;
  return Math.round(major * 10 ** (digits ?? 2));
}

/** Minor units as a plain decimal string for a form input, e.g. 12345 EUR to "123.45". */
export function toMajorUnitsInput(minor: number, currency: string): string {
  const digits = new Intl.NumberFormat("en-US", { style: "currency", currency }).resolvedOptions()
    .maximumFractionDigits ?? 2;
  return (minor / 10 ** digits).toFixed(digits);
}

export function currencySymbol(currency: string, locale = "en-US"): string {
  if (!isIsoCurrency(currency)) throw new RangeError(`invalid ISO 4217 currency: ${currency}`);
  const parts = new Intl.NumberFormat(locale, { style: "currency", currency }).formatToParts(0);
  return parts.find((p) => p.type === "currency")?.value ?? currency;
}
