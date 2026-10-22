import { appendFile, stat } from "node:fs/promises";
import { join } from "node:path";
import type { Connector, IntegrationEvent } from "./types";

const COLUMNS = [
  "event_id",
  "record_type",
  "reference",
  "line_number",
  "description",
  "quantity",
  "unit_price_minor",
  "supplier",
  "cost_center",
  "currency",
  "total_minor",
  "issued_on",
  "invoice_number",
  "purchase_order",
] as const;

function escapeCell(value: string | number | undefined | null): string {
  let s = value === undefined || value === null ? "" : String(value);
  // Spreadsheets run cells that start with these as formulas; plain numbers stay numbers for the ERP importer.
  if (/^[=+\-@]/.test(s) && !/^[+-]?\d+(\.\d+)?$/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

type Row = Partial<Record<(typeof COLUMNS)[number], string | number | undefined>>;

export function eventToCsvRows(event: IntegrationEvent): Row[] {
  return rowsFor(event).map((row) => ({ ...row, event_id: event.id }));
}

function rowsFor(event: IntegrationEvent): Row[] {
  switch (event.type) {
    case "PO_CREATED":
      return poRows(event.payload);
    case "INVOICE_APPROVED":
      return invoiceRows(event.payload);
    default:
      throw new Error(`Unsupported event type for CSV export: ${event.type}`);
  }
}

function poRows(p: Record<string, unknown>): Row[] {
  const lines = (p.lines as Record<string, unknown>[]) ?? [];
  const base: Row = {
    record_type: undefined,
    reference: p.purchaseOrderId as string,
    supplier: p.supplier as string,
    cost_center: p.costCenter as string,
    currency: p.currency as string,
    total_minor: String(p.totalMinor),
    issued_on: p.issuedOn as string,
  };
  const header: Row = { ...base, record_type: "PO_HEADER" };
  const lineRows = lines.map((l, i): Row => ({
    ...base,
    record_type: "PO_LINE",
    line_number: i + 1,
    description: l.description as string,
    quantity: String(l.quantity),
    unit_price_minor: String(l.unitPriceMinor),
  }));
  return [header, ...lineRows];
}

function invoiceRows(p: Record<string, unknown>): Row[] {
  return [
    {
      record_type: "INVOICE_HEADER",
      reference: p.invoiceId as string,
      invoice_number: p.invoiceNumber as string,
      supplier: p.supplier as string,
      currency: p.currency as string,
      total_minor: String(p.totalMinor),
      purchase_order: p.purchaseOrderId as string,
    },
  ];
}

export function toCsv(rows: Row[]): string {
  const lines = [COLUMNS.join(",")];
  for (const row of rows) {
    lines.push(COLUMNS.map((c) => escapeCell(row[c])).join(","));
  }
  return lines.join("\n") + "\n";
}

export function poToCsv(event: IntegrationEvent): string {
  return toCsv(eventToCsvRows(event));
}

export function invoiceToCsv(event: IntegrationEvent): string {
  return toCsv(eventToCsvRows(event));
}

export interface CsvConnectorOptions {
  dir: string;
  now?: () => Date;
}

/** CSV connector: appends rows to one file per UTC day and event type
 *  (header written once) for ERP file import. Every row carries the event id
 *  so an importer can dedupe a replayed file. */
export function createCsvConnector({ dir, now = () => new Date() }: CsvConnectorOptions): Connector {
  return {
    name: "csv",
    handles: ["PO_CREATED", "INVOICE_APPROVED"],
    async deliver(event) {
      try {
        const rows = eventToCsvRows(event);
        const file = join(dir, `${event.type}-${now().toISOString().slice(0, 10)}.csv`);
        const isNew = !(await stat(file).catch(() => null));
        const csv = toCsv(rows);
        await appendFile(file, isNew ? csv : csv.slice(csv.indexOf("\n") + 1));
        return { ok: true, response: { file, bytes: csv.length } };
      } catch (error) {
        return { ok: false, error: String(error), retryable: true };
      }
    },
  };
}
