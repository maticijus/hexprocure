import { describe, it, expect } from "vitest";
import { poEventToQboPurchaseOrder, invoiceEventToQboBill } from "./qbo";

describe("QBO mappers", () => {
  const poEvent = {
    id: "e1",
    type: "PO_CREATED" as const,
    payload: {
      purchaseOrderId: "po-1",
      supplier: "Acme GmbH",
      currency: "EUR",
      costCenter: "IT",
      issuedOn: "2026-08-24",
      totalMinor: 19990,
      lines: [
        { description: "Laptop", quantity: 10, unitPriceMinor: 1999 },
        { description: "Dock", quantity: 1, unitPriceMinor: 0 },
      ],
    },
  };

  it("maps a PO event to QBO PurchaseOrder shape", () => {
    const q = poEventToQboPurchaseOrder(poEvent);
    expect(q.VendorRef).toBe("Acme GmbH");
    expect(q.CurrencyRef).toBe("EUR");
    expect(q.ClassRef).toBe("IT");
    expect(q.TxnDate).toBe("2026-08-24");
    expect(q.Line).toHaveLength(2);
    expect(q.Line[0]).toMatchObject({
      DetailType: "AccountBasedExpenseLineDetail",
      Description: "Laptop",
      Amount: 199.9,
    });
  });

  it("converts minor units to decimal amounts without float drift", () => {
    const q = poEventToQboPurchaseOrder(poEvent);
    expect(q.Line[0].Amount).toBeCloseTo(199.9, 10);
    expect(q.TotalAmt).toBeCloseTo(199.9, 10);
  });

  it("maps an approved invoice to QBO Bill shape", () => {
    const event = {
      id: "e2",
      type: "INVOICE_APPROVED" as const,
      payload: {
        invoiceId: "inv-1",
        invoiceNumber: "INV-001",
        supplier: "Acme GmbH",
        currency: "EUR",
        totalMinor: 5000,
        purchaseOrderId: "po-1",
      },
    };
    const b = invoiceEventToQboBill(event);
    expect(b).toMatchObject({
      VendorRef: "Acme GmbH",
      DocNumber: "INV-001",
      CurrencyRef: "EUR",
      TotalAmt: 50,
    });
    expect(b.Links?.[0]).toMatchObject({ HexProcureInvoiceId: "inv-1" });
  });

  it("rejects events with missing supplier", () => {
    const bad = { ...poEvent, payload: { ...poEvent.payload, supplier: undefined } };
    expect(() => poEventToQboPurchaseOrder(bad)).toThrow(/supplier/i);
  });

  it("rejects non-PO event types", () => {
    expect(() =>
      poEventToQboPurchaseOrder({ id: "x", type: "INVOICE_APPROVED", payload: {} }),
    ).toThrow(/PO_CREATED/);
  });
});
