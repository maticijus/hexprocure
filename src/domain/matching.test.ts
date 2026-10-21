import { describe, it, expect } from "vitest";
import {
  matchInvoice,
  type MatchContext,
  type PoLine,
  type InvoiceLine,
} from "./matching";

const po = (id: string, ordered: number, unitPrice: number): PoLine => ({
  id,
  quantityOrdered: ordered,
  unitPriceMinor: unitPrice,
});

const inv = (poLineId: string | null, qty: number, unitPrice: number): InvoiceLine => ({
  poLineId,
  quantity: qty,
  unitPriceMinor: unitPrice,
});

const baseScenario = (): MatchContext => ({
  poLines: [po("pl-1", 10, 1999)],
  receivedQtyByPoLine: { "pl-1": 10 } as Record<string, number>,
  previouslyInvoicedQtyByPoLine: {} as Record<string, number>,
});

describe("matchInvoice", () => {
  it("matches a clean invoice against fully received PO", () => {
    const r = matchInvoice(baseScenario(), [inv("pl-1", 10, 1999)]);
    expect(r.status).toBe("MATCHED");
    expect(r.exceptions).toEqual([]);
  });

  it("flags a line with no PO reference as UNMATCHED_LINE", () => {
    const r = matchInvoice(baseScenario(), [inv(null, 5, 1999)]);
    expect(r.status).toBe("EXCEPTION");
    expect(r.exceptions[0]).toMatchObject({
      type: "UNMATCHED_LINE",
      invoiceLineIndex: 0,
    });
  });

  it("flags an invoice line pointing at a nonexistent PO line", () => {
    const r = matchInvoice(baseScenario(), [inv("ghost", 5, 1999)]);
    expect(r.exceptions[0].type).toBe("UNMATCHED_LINE");
  });

  it("flags QUANTITY_MISMATCH when invoicing more than was received", () => {
    const s = baseScenario();
    s.receivedQtyByPoLine = { "pl-1": 6 };
    const r = matchInvoice(s, [inv("pl-1", 10, 1999)]);
    expect(r.status).toBe("EXCEPTION");
    expect(r.exceptions[0].type).toBe("QUANTITY_MISMATCH");
  });

  it("allows partial invoicing up to received quantity", () => {
    const r = matchInvoice(baseScenario(), [inv("pl-1", 7, 1999)]);
    expect(r.status).toBe("MATCHED");
  });

  it("flags OVER_INVOICED when prior invoices already consumed the PO line", () => {
    const s = baseScenario();
    s.previouslyInvoicedQtyByPoLine = { "pl-1": 8 };
    const r = matchInvoice(s, [inv("pl-1", 3, 1999)]);
    expect(r.status).toBe("EXCEPTION");
    expect(r.exceptions.map((e) => e.type)).toContain("OVER_INVOICED");
  });

  it("flags PRICE_MISMATCH beyond tolerance", () => {
    const r = matchInvoice(baseScenario(), [inv("pl-1", 10, 2500)]);
    expect(r.exceptions[0].type).toBe("PRICE_MISMATCH");
  });

  it("accepts price within 2% tolerance", () => {
    // 2% of 1999 = 39.98 → max accepted invoice price is 2038
    const r = matchInvoice(baseScenario(), [inv("pl-1", 10, 2038)]);
    expect(r.status).toBe("MATCHED");
  });

  it("applies absolute floor tolerance of 0.50 minor units on cheap items", () => {
    const cheap = { ...baseScenario(), poLines: [po("pl-1", 10, 5)] };
    // 2% of 5 = 0.1 → floor 0.50 applies; diff of 0.5 accepted, 1 not
    expect(matchInvoice(cheap, [inv("pl-1", 10, 6)]).status).toBe("EXCEPTION");
    const ok = matchInvoice(cheap, [inv("pl-1", 10, 5)]);
    expect(ok.status).toBe("MATCHED");
  });

  it("collects multiple exceptions across lines in one run", () => {
    const s = baseScenario();
    s.poLines.push(po("pl-2", 4, 500));
    s.receivedQtyByPoLine["pl-2"] = 4;
    const r = matchInvoice(s, [
      inv(null, 1, 100),
      inv("pl-1", 10, 9999),
      inv("pl-2", 4, 500),
    ]);
    expect(r.exceptions.map((e) => e.type)).toEqual([
      "UNMATCHED_LINE",
      "PRICE_MISMATCH",
    ]);
    expect(r.status).toBe("EXCEPTION");
  });

  it("rejects non-positive quantities", () => {
    expect(() => matchInvoice(baseScenario(), [inv("pl-1", 0, 1999)])).toThrow(
      /quantity/,
    );
    expect(() => matchInvoice(baseScenario(), [inv("pl-1", -3, 1999)])).toThrow(
      /quantity/,
    );
  });

  it("rejects empty invoice", () => {
    expect(() => matchInvoice(baseScenario(), [])).toThrow(/no lines/i);
  });
});

describe("cumulative cap at received across invoices (B5)", () => {
  const halfReceived = (): MatchContext => ({
    poLines: [po("pl-1", 10, 1999)],
    receivedQtyByPoLine: { "pl-1": 5 },
    previouslyInvoicedQtyByPoLine: {},
  });

  it("matches the first invoice of 5 against 5 received", () => {
    expect(matchInvoice(halfReceived(), [inv("pl-1", 5, 1999)]).status).toBe("MATCHED");
  });

  it("flags QUANTITY_MISMATCH when a second invoice of 5 would exceed 5 received", () => {
    const ctx = { ...halfReceived(), previouslyInvoicedQtyByPoLine: { "pl-1": 5 } };
    const r = matchInvoice(ctx, [inv("pl-1", 5, 1999)]);
    expect(r.status).toBe("EXCEPTION");
    expect(r.exceptions).toEqual([
      expect.objectContaining({ type: "QUANTITY_MISMATCH", invoiceLineIndex: 0, poLineId: "pl-1" }),
    ]);
  });
});

describe("running total when one invoice repeats a PO line (B6)", () => {
  it("flags QUANTITY_MISMATCH on the repeat when 3 + 3 exceeds 5 received", () => {
    const ctx: MatchContext = {
      poLines: [po("pl-1", 10, 1999)],
      receivedQtyByPoLine: { "pl-1": 5 },
      previouslyInvoicedQtyByPoLine: {},
    };
    const r = matchInvoice(ctx, [inv("pl-1", 3, 1999), inv("pl-1", 3, 1999)]);
    expect(r.exceptions).toEqual([
      expect.objectContaining({ type: "QUANTITY_MISMATCH", invoiceLineIndex: 1 }),
    ]);
  });

  it("flags OVER_INVOICED on the repeat when 6 + 6 exceeds 10 ordered", () => {
    const r = matchInvoice(baseScenario(), [inv("pl-1", 6, 1999), inv("pl-1", 6, 1999)]);
    expect(r.exceptions.map((e) => [e.type, e.invoiceLineIndex])).toContainEqual(["OVER_INVOICED", 1]);
  });

  it("flags OVER_INVOICED_AMOUNT when repeated service amounts exceed the line amount", () => {
    const ctx: MatchContext = {
      poLines: [{ id: "svc-1", quantityOrdered: 1, unitPriceMinor: 1000, kind: "SERVICE" }],
      receivedQtyByPoLine: {},
      previouslyInvoicedQtyByPoLine: {},
    };
    const line = { poLineId: "svc-1", quantity: 1, unitPriceMinor: 0, amountMinor: 600 };
    const r = matchInvoice(ctx, [line, line]);
    expect(r.exceptions).toEqual([
      expect.objectContaining({ type: "OVER_INVOICED_AMOUNT", invoiceLineIndex: 1 }),
    ]);
  });

  describe("service acceptance", () => {
    const svcCtx = (accepted?: Record<string, number>): MatchContext => ({
      poLines: [{ id: "svc-1", quantityOrdered: 1, unitPriceMinor: 1000, kind: "SERVICE" }],
      receivedQtyByPoLine: {},
      previouslyInvoicedQtyByPoLine: {},
      acceptedAmountByPoLine: accepted,
    });
    const svcLine = { poLineId: "svc-1", quantity: 1, unitPriceMinor: 0, amountMinor: 1000 };

    it("flags SERVICE_NOT_ACCEPTED when nothing is accepted", () => {
      const r = matchInvoice(svcCtx({}), [svcLine]);
      expect(r.exceptions).toEqual([
        expect.objectContaining({ type: "SERVICE_NOT_ACCEPTED", invoiceLineIndex: 0 }),
      ]);
    });

    it("matches when the accepted amount covers the invoiced amount", () => {
      expect(matchInvoice(svcCtx({ "svc-1": 1000 }), [svcLine]).status).toBe("MATCHED");
    });

    it("flags SERVICE_NOT_ACCEPTED when invoiced exceeds accepted", () => {
      const r = matchInvoice(svcCtx({ "svc-1": 400 }), [svcLine]);
      expect(r.exceptions.map((e) => e.type)).toContain("SERVICE_NOT_ACCEPTED");
    });
  });
});
