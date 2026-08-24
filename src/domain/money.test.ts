import { describe, it, expect } from "vitest";
import { Money } from "./money";

describe("Money construction", () => {
  it("creates money from minor units", () => {
    expect(Money.of(1050, "EUR").amount).toBe(1050);
  });

  it("rejects fractional minor units", () => {
    expect(() => Money.of(10.5, "EUR")).toThrow(/whole minor units/);
  });

  it("rejects NaN and Infinity", () => {
    expect(() => Money.of(NaN, "EUR")).toThrow();
    expect(() => Money.of(Infinity, "EUR")).toThrow();
  });

  it("rejects non-ISO-looking currency codes", () => {
    expect(() => Money.of(100, "euro")).toThrow(/3-letter/);
    expect(() => Money.of(100, "EURO")).toThrow(/3-letter/);
  });

  it("normalizes currency code to uppercase", () => {
    expect(Money.of(100, "eur").currency).toBe("EUR");
  });
});

describe("Money arithmetic", () => {
  it("adds same-currency amounts", () => {
    expect(Money.of(100, "USD").add(Money.of(250, "USD")).amount).toBe(350);
  });

  it("rejects adding different currencies", () => {
    expect(() => Money.of(100, "USD").add(Money.of(100, "EUR"))).toThrow(
      /currency mismatch/i,
    );
  });

  it("subtracts leaving zero", () => {
    expect(Money.of(500, "USD").subtract(Money.of(500, "USD")).amount).toBe(0);
  });

  it("rejects results below zero by default", () => {
    expect(() => Money.of(100, "USD").subtract(Money.of(200, "USD"))).toThrow(
      /negative/,
    );
  });

  it("allows negative result when explicitly permitted", () => {
    const m = Money.of(100, "USD")
      .subtract(Money.of(300, "USD"), { allowNegative: true });
    expect(m.amount).toBe(-200);
  });

  it("multiplies by an integer quantity", () => {
    expect(Money.of(1999, "USD").multiply(3).amount).toBe(5997);
  });

  it("rejects multiplying by a fraction", () => {
    expect(() => Money.of(100, "USD").multiply(1.5)).toThrow(/whole number/);
  });
});

describe("Money comparison", () => {
  it("compares equal amounts", () => {
    expect(Money.of(100, "USD").equals(Money.of(100, "USD"))).toBe(true);
    expect(Money.of(100, "USD").equals(Money.of(101, "USD"))).toBe(false);
  });

  it("isLessThanOrEqual works across boundary", () => {
    expect(Money.of(99, "EUR").isLessThanOrEqual(Money.of(100, "EUR"))).toBe(true);
    expect(Money.of(101, "EUR").isLessThanOrEqual(Money.of(100, "EUR"))).toBe(false);
  });

  it("isLessThanOrEqual rejects different currencies", () => {
    expect(() =>
      Money.of(1, "EUR").isLessThanOrEqual(Money.of(1, "USD")),
    ).toThrow(/currency mismatch/i);
  });
});
