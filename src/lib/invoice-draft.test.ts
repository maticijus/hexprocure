import { describe, expect, it } from "vitest";
import { applyExtracted, prefillLines, toInvoicePayload, type PoLineOption } from "./invoice-draft";

const goods: PoLineOption = { id: "g1", description: "Monitor", kind: "GOODS", quantityOrdered: 2, unitPriceMinor: 10_000 };
const service: PoLineOption = { id: "s1", description: "Install", kind: "SERVICE", quantityOrdered: 1, unitPriceMinor: 50_000 };

describe("prefillLines", () => {
  it("copies goods qty and price, and services as one line at the ordered amount", () => {
    expect(prefillLines([goods, service], "EUR")).toEqual([
      { poLineId: "g1", description: "Monitor", kind: "GOODS", quantity: "2", unitPrice: "100.00" },
      { poLineId: "s1", description: "Install", kind: "SERVICE", quantity: "1", unitPrice: "500.00" },
    ]);
  });
});

describe("toInvoicePayload", () => {
  it("converts to minor units and sends the service amount as authoritative", () => {
    const payload = toInvoicePayload(prefillLines([goods, service], "EUR"), "EUR");
    expect(payload).toEqual([
      { poLineId: "g1", quantity: 2, unitPriceMinor: 10_000 },
      { poLineId: "s1", quantity: 1, unitPriceMinor: 50_000, amountMinor: 50_000 },
    ]);
  });

  it("drops lines with zero quantity", () => {
    const lines = prefillLines([goods], "EUR").map((l) => ({ ...l, quantity: "0" }));
    expect(toInvoicePayload(lines, "EUR")).toEqual([]);
  });

  it("honours zero-decimal currencies", () => {
    const lines = prefillLines([{ ...goods, unitPriceMinor: 1500 }], "JPY");
    expect(lines[0].unitPrice).toBe("1500");
    expect(toInvoicePayload(lines, "JPY")[0].unitPriceMinor).toBe(1500);
  });
});

describe("applyExtracted", () => {
  const proposed = (over: object) => ({
    description: "x", quantity: 1, unitPriceMinor: 0, amountMinor: 0, poLineId: null, confidence: "HIGH" as const, warnings: [], ...over,
  });

  it("overrides matching PO lines and leaves the rest untouched", () => {
    const base = prefillLines([goods, service], "EUR");
    const next = applyExtracted(base, [proposed({ poLineId: "g1", quantity: 1, unitPriceMinor: 9_900, amountMinor: 9_900 })], "EUR");
    expect(next[0]).toMatchObject({ quantity: "1", unitPrice: "99.00" });
    expect(next[1]).toEqual(base[1]);
    expect(base[0].quantity).toBe("2");
  });

  it("uses amountMinor for service lines", () => {
    const next = applyExtracted(prefillLines([service], "EUR"), [proposed({ poLineId: "s1", amountMinor: 45_000 })], "EUR");
    expect(next[0]).toMatchObject({ quantity: "1", unitPrice: "450.00" });
  });
});
