import { describe, it, expect } from "vitest";
import { eventToCsvRows, poToCsv, invoiceToCsv } from "./csv";

describe("CSV connector", () => {
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
      ],
    },
  };

  it("converts a PO event into header + line rows", () => {
    const rows = eventToCsvRows(poEvent);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      record_type: "PO_HEADER",
      reference: "po-1",
      supplier: "Acme GmbH",
      total_minor: "19990",
    });
    expect(rows[1]).toMatchObject({
      record_type: "PO_LINE",
      reference: "po-1",
      description: "Laptop",
      quantity: "10",
    });
  });

  it("escapes commas and quotes in descriptions", () => {
    const event = {
      ...poEvent,
      payload: {
        ...poEvent.payload,
        lines: [{ description: 'Laptop, 14" pro', quantity: 1, unitPriceMinor: 100 }],
      },
    };
    const csv = poToCsv(event);
    expect(csv).toContain('"Laptop, 14"" pro"');
  });

  it("produces stable column order across rows", () => {
    const csv = poToCsv(poEvent);
    const header = csv.split("\n")[0];
    expect(header.split(",").indexOf("record_type")).toBeLessThan(
      header.split(",").indexOf("reference"),
    );
    for (const line of csv.split("\n").slice(1)) {
      expect(line.split(",").length).toBe(header.split(",").length);
    }
  });

  it("emits invoice rows from INVOICE_APPROVED events", () => {
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
    const rows = eventToCsvRows(event);
    expect(rows[0]).toMatchObject({
      record_type: "INVOICE_HEADER",
      reference: "inv-1",
      invoice_number: "INV-001",
    });
    expect(invoiceToCsv(event)).toContain("INVOICE_HEADER");
  });

  it("throws on unsupported event types", () => {
    expect(() => eventToCsvRows({ id: "x", type: "PO_CANCELLED", payload: {} })).toThrow(
      /unsupported/i,
    );
  });
});
