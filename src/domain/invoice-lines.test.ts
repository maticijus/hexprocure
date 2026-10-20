import { describe, it, expect } from "vitest";
import {
  normaliseExtractedLines,
  parseAmount,
  type PoLineContext,
  type RawExtractedLine,
} from "./invoice-lines";

const po: PoLineContext[] = [
  { id: "po-1", description: "Laptop stand", quantityOrdered: 2, unitPriceMinor: 12_345, kind: "GOODS" },
  { id: "po-2", description: "Consulting", quantityOrdered: 10, unitPriceMinor: 9_000, kind: "SERVICE" },
];

const raw = (over: Partial<RawExtractedLine> = {}): RawExtractedLine => ({
  description: "Laptop stand",
  quantity: 2,
  unitPrice: "123,45",
  lineTotal: "246,90",
  poLineRef: "po-1",
  ...over,
});

describe("parseAmount", () => {
  it("parses EU decimal comma with thousands dots", () => {
    expect(parseAmount("1.234,50")).toBe(123_450);
  });
  it("parses US format", () => {
    expect(parseAmount("1,234.50")).toBe(123_450);
  });
  it("returns null for garbage", () => {
    expect(parseAmount("abc")).toBeNull();
  });
});

describe("normaliseExtractedLines", () => {
  it("parses an EU decimal comma price to minor units", () => {
    const [l] = normaliseExtractedLines([raw({ unitPrice: "1.234,50", quantity: 2, lineTotal: null })], po, "EUR");
    expect(l.unitPriceMinor).toBe(123_450);
    expect(l.amountMinor).toBe(246_900);
  });

  it("rounds fractional quantity with a warning", () => {
    const [l] = normaliseExtractedLines([raw({ quantity: 2.5, lineTotal: null })], po, "EUR");
    expect(l.quantity).toBe(3);
    expect(l.warnings).toContain("quantity rounded from 2.5");
  });

  it("drops an unknown poLineRef to null with a warning", () => {
    const [l] = normaliseExtractedLines([raw({ poLineRef: "nope", description: "Zzz", unitPrice: "1,00", lineTotal: null })], po, "EUR");
    expect(l.poLineId).toBeNull();
    expect(l.warnings).toContain("unknown poLineRef dropped");
  });

  it("matches by exact description when no ref, confidence LOW", () => {
    const [l] = normaliseExtractedLines([raw({ poLineRef: null, description: "laptop STAND" })], po, "EUR");
    expect(l.poLineId).toBe("po-1");
    expect(l.confidence).toBe("LOW");
  });

  it("matches by price within 2 percent and equal quantity, confidence LOW", () => {
    const [l] = normaliseExtractedLines(
      [raw({ poLineRef: null, description: "Notebook riser", unitPrice: "124,00", quantity: 2, lineTotal: null })],
      po,
      "EUR",
    );
    expect(l.poLineId).toBe("po-1");
    expect(l.confidence).toBe("LOW");
  });

  it("sets HIGH for a valid model-picked id with agreeing total", () => {
    const [l] = normaliseExtractedLines([raw()], po, "EUR");
    expect(l.poLineId).toBe("po-1");
    expect(l.confidence).toBe("HIGH");
    expect(l.warnings).toEqual([]);
  });

  it("lowers confidence when lineTotal disagrees and uses the parsed total", () => {
    const [l] = normaliseExtractedLines([raw({ lineTotal: "300,00" })], po, "EUR");
    expect(l.confidence).toBe("LOW");
    expect(l.amountMinor).toBe(30_000);
    expect(l.warnings.length).toBeGreaterThan(0);
  });

  it("drops empty descriptions", () => {
    expect(normaliseExtractedLines([raw({ description: "   " })], po, "EUR")).toEqual([]);
  });

  it("caps at 200 lines", () => {
    const many = Array.from({ length: 250 }, (_, i) => raw({ description: `Item ${i}`, poLineRef: null }));
    expect(normaliseExtractedLines(many, po, "EUR")).toHaveLength(200);
  });
});
