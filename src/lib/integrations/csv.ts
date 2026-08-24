import type { IntegrationEvent } from "./types";

const COLUMNS = [
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
  const s = value === undefined || value === null ? "" : String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

type Row = Record<(typeof COLUMNS)[number], string | number | undefined>;

export function eventToCsvRows(event: IntegrationEvent): Row[] {
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
