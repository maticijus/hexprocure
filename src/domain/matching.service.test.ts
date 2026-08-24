import { describe, it, expect } from "vitest";
import { matchInvoice, type MatchContext } from "./matching";

const svcScenario = (): MatchContext => ({
  poLines: [{ id: "svc-1", quantityOrdered: 1, unitPriceMinor: 1_000_000, kind: "SERVICE" }],
  receivedQtyByPoLine: { "svc-1": 0 },
  previouslyInvoicedQtyByPoLine: {},
  previouslyInvoicedAmountByPoLine: {},
});

describe("SERVICE lines (amount-only matching)", () => {
  it("matches without any receipt when the amount fits", () => {
    const r = matchInvoice(svcScenario(), [
      { poLineId: "svc-1", quantity: 1, unitPriceMinor: 0, amountMinor: 1_000_000 },
    ]);
    expect(r.status).toBe("MATCHED");
  });

  it("never flags QUANTITY_MISMATCH or PRICE_MISMATCH for services", () => {
    const r = matchInvoice(svcScenario(), [
      { poLineId: "svc-1", quantity: 999, unitPriceMinor: 42, amountMinor: 500_000 },
    ]);
    expect(r.exceptions.map((e) => e.type)).not.toContain("QUANTITY_MISMATCH");
    expect(r.exceptions.map((e) => e.type)).not.toContain("PRICE_MISMATCH");
  });

  it("flags OVER_INVOICED_AMOUNT when cumulative amounts exceed ordered", () => {
    const ctx = svcScenario();
    ctx.previouslyInvoicedAmountByPoLine = { "svc-1": 800_000 };
    const r = matchInvoice(ctx, [
      { poLineId: "svc-1", quantity: 1, unitPriceMinor: 0, amountMinor: 300_000 },
    ]);
    expect(r.status).toBe("EXCEPTION");
    expect(r.exceptions[0].type).toBe("OVER_INVOICED_AMOUNT");
  });

  it("allows partial billing up to the ordered amount (boundary)", () => {
    const ctx = svcScenario();
    ctx.previouslyInvoicedAmountByPoLine = { "svc-1": 600_000 };
    const r = matchInvoice(ctx, [
      { poLineId: "svc-1", quantity: 1, unitPriceMinor: 0, amountMinor: 400_000 },
    ]);
    expect(r.status).toBe("MATCHED");
  });

  it("falls back to qty×price when amountMinor is omitted on a service line", () => {
    const r = matchInvoice(svcScenario(), [
      { poLineId: "svc-1", quantity: 2, unitPriceMinor: 600_000 },
    ]);
    expect(r.exceptions[0].type).toBe("OVER_INVOICED_AMOUNT");
  });

  it("mixed PO: goods behave as before while service checks amounts", () => {
    const ctx: MatchContext = {
      poLines: [
        { id: "g1", quantityOrdered: 2, unitPriceMinor: 1000, kind: "GOODS" },
        { id: "s1", quantityOrdered: 1, unitPriceMinor: 500_000, kind: "SERVICE" },
      ],
      receivedQtyByPoLine: { g1: 0 },
      previouslyInvoicedQtyByPoLine: {},
      previouslyInvoicedAmountByPoLine: {},
    };
    const r = matchInvoice(ctx, [
      { poLineId: "g1", quantity: 3, unitPriceMinor: 1000 },   // qty mismatch
      { poLineId: "s1", quantity: 1, unitPriceMinor: 0, amountMinor: 999_999_999 }, // over
    ]);
    expect(r.exceptions.map((e) => e.type)).toEqual([
      "QUANTITY_MISMATCH",
      "OVER_INVOICED",
      "OVER_INVOICED_AMOUNT",
    ]);
  });
});
