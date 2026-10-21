import { afterEach, beforeEach, describe, it, expect } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createCsvConnector, eventToCsvRows, poToCsv, invoiceToCsv } from "./csv";

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
      event_id: poEvent.id,
      record_type: "PO_HEADER",
      reference: "po-1",
      supplier: "Acme GmbH",
      total_minor: "19990",
    });
    expect(rows[1]).toMatchObject({
      event_id: poEvent.id,
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
    for (const line of csv.split("\n").filter((l) => l.length > 0).slice(1)) {
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

describe("CSV file connector", () => {
  const event = {
    id: "e1",
    type: "INVOICE_APPROVED" as const,
    payload: { invoiceId: "i1", invoiceNumber: "N1", supplier: "S", currency: "EUR", totalMinor: 100 },
  };
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "hx-csv-"));
  });
  afterEach(() => rm(dir, { recursive: true, force: true }));

  it("writes the row to a per-day, per-type file", async () => {
    const outcome = await createCsvConnector({ dir, now: () => new Date("2026-10-21T10:00:00Z") }).deliver(event);

    expect(outcome.ok).toBe(true);
    const text = await readFile(join(dir, "INVOICE_APPROVED-2026-10-21.csv"), "utf8");
    expect(text).toContain("e1,INVOICE_HEADER,i1");
    expect(text.startsWith("event_id,record_type,")).toBe(true);
  });

  it("appends later events and writes the header once", async () => {
    const connector = createCsvConnector({ dir, now: () => new Date("2026-10-21T10:00:00Z") });
    await connector.deliver(event);
    await connector.deliver({ ...event, id: "e2" });

    const lines = (await readFile(join(dir, "INVOICE_APPROVED-2026-10-21.csv"), "utf8")).trim().split("\n");
    expect(lines).toHaveLength(3);
    expect(lines.filter((l) => l.startsWith("event_id,record_type,"))).toHaveLength(1);
  });

  it("reports a write failure instead of delivering", async () => {
    const outcome = await createCsvConnector({ dir: join(dir, "missing", "x") }).deliver(event);
    expect(outcome.ok).toBe(false);
  });
});
