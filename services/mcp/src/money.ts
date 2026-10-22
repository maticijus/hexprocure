// Same rule as the app's src/lib/format.ts formatMoney, copied so this package stays standalone.
export function formatMoney(minor: number, currency: string, locale = "en-US"): string {
  const formatter = new Intl.NumberFormat(locale, { style: "currency", currency });
  return formatter.format(minor / 10 ** (formatter.resolvedOptions().maximumFractionDigits ?? 2));
}

/** Adds a `<name>Formatted` sibling to every integer `<name>Minor` field, in the nearest row `currency`. */
export function withFormattedMoney(value: unknown, currency?: string): unknown {
  if (Array.isArray(value)) return value.map((v) => withFormattedMoney(v, currency));
  if (value === null || typeof value !== "object") return value;
  const row = value as Record<string, unknown>;
  const rowCurrency = typeof row.currency === "string" ? row.currency : currency;
  const out: Record<string, unknown> = {};
  for (const [key, v] of Object.entries(row)) {
    out[key] = withFormattedMoney(v, rowCurrency);
    if (key.endsWith("Minor") && Number.isInteger(v) && rowCurrency) {
      try {
        out[`${key.slice(0, -5)}Formatted`] = formatMoney(v as number, rowCurrency);
      } catch {
        // unknown currency code: keep minor units only
      }
    }
  }
  return out;
}
