import { describe, it, expect } from "vitest";
import { currencySymbol, formatMoney } from "./format";

const plain = (s: string) => s.replace(/ /g, " ");

describe("formatMoney", () => {
  it("formats EUR with two decimals", () => {
    expect(plain(formatMoney(123_456, "EUR"))).toBe("€1,234.56");
  });

  it("formats USD with two decimals", () => {
    expect(plain(formatMoney(5, "USD"))).toBe("$0.05");
  });

  it("treats JPY as a zero-decimal currency", () => {
    expect(plain(formatMoney(1_500, "JPY"))).toBe("¥1,500");
  });

  it("formats CZK in a Czech locale", () => {
    expect(plain(formatMoney(1_234_500, "CZK", "cs-CZ"))).toBe("12 345,00 Kč");
  });

  it("formats negative amounts", () => {
    expect(plain(formatMoney(-250, "EUR"))).toBe("-€2.50");
  });

  it("rejects fractional minor units", () => {
    expect(() => formatMoney(1.5, "EUR")).toThrow();
  });

  it("rejects malformed currency codes", () => {
    expect(() => formatMoney(100, "eu")).toThrow();
  });
});

describe("currencySymbol", () => {
  it("returns the symbol for the currency", () => {
    expect(currencySymbol("EUR")).toBe("€");
    expect(currencySymbol("USD")).toBe("$");
  });
});
