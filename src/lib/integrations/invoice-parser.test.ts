import { describe, it, expect } from "vitest";
import { parseInvoiceText } from "./invoice-parser";

const SAMPLE = `
Acme Office GmbH
Rechnung ACME-2026-001
Invoice Date: 2026-08-14

Standing Desk          4 x 449.00      1,796.00
Office Chair           2 x 129.50        259.00

Total Amount: EUR 2,055.00
VAT ID: DE123456789
`;

describe("parseInvoiceText", () => {
  it("extracts the invoice number", () => {
    const d = parseInvoiceText(SAMPLE);
    expect(d.invoiceNumber).toBe("ACME-2026-001");
  });

  it("extracts the invoice date in ISO form", () => {
    expect(parseInvoiceText(SAMPLE).issueDate).toBe("2026-08-14");
  });

  it("extracts the grand total as minor units", () => {
    expect(parseInvoiceText(SAMPLE).totalMinor).toBe(205_500);
  });

  it("extracts the VAT id when present", () => {
    expect(parseInvoiceText(SAMPLE).vatId).toBe("DE123456789");
  });

  it("returns null fields it cannot find rather than guessing", () => {
    const d = parseInvoiceText("hello world");
    expect(d.invoiceNumber).toBeNull();
    expect(d.issueDate).toBeNull();
    expect(d.totalMinor).toBeNull();
    expect(d.vatId).toBeNull();
  });

  it("handles European decimal-comma totals", () => {
    const d = parseInvoiceText("Gesamtbetrag: 1.234,56 EUR");
    expect(d.totalMinor).toBe(123_456);
  });

  it("prefers labeled totals over random amounts", () => {
    const d = parseInvoiceText("Item 99.00\nTotal: 150.00");
    expect(d.totalMinor).toBe(15_000);
  });

  it("marks low confidence when key fields are missing", () => {
    const d = parseInvoiceText("some scanned noise without any fields");
    expect(d.confidence).toBe("LOW");
    const full = parseInvoiceText(SAMPLE);
    expect(full.confidence).toBe("HIGH");
  });

  it("accepts DD.MM.YYYY dates", () => {
    expect(parseInvoiceText("Datum: 14.08.2026").issueDate).toBe("2026-08-14");
  });
});
