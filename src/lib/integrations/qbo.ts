import type { IntegrationEvent } from "./types";

interface QboLine {
  DetailType: "AccountBasedExpenseLineDetail";
  Description: string;
  Amount: number;
  AccountBasedExpenseLineDetail?: { ClassRef?: string };
}

const toDecimal = (minor: unknown): number =>
  Number(((minor as number) / 100).toFixed(2));

export interface QboPurchaseOrder {
  VendorRef: string;
  CurrencyRef: string;
  ClassRef?: string;
  TxnDate: string;
  PORef?: string;
  Line: QboLine[];
  TotalAmt: number;
}

export function poEventToQboPurchaseOrder(event: IntegrationEvent): QboPurchaseOrder {
  if (event.type !== "PO_CREATED") {
    throw new Error(`Expected PO_CREATED event, got ${event.type}`);
  }
  const p = event.payload;
  const supplier = requireField(p.supplier, "supplier");
  const lines = (p.lines as Record<string, unknown>[]) ?? [];
  return {
    VendorRef: supplier,
    CurrencyRef: (p.currency as string) ?? "EUR",
    ...(p.costCenter ? { ClassRef: p.costCenter as string } : {}),
    TxnDate: (p.issuedOn as string) ?? new Date().toISOString().slice(0, 10),
    PORef: p.purchaseOrderId as string,
    Line: lines.map((l) => ({
      DetailType: "AccountBasedExpenseLineDetail" as const,
      Description: String(l.description ?? ""),
      Amount: toDecimal(
        ((l.unitPriceMinor as number) ?? 0) * ((l.quantity as number) ?? 0),
      ),
      ...(p.costCenter
        ? { AccountBasedExpenseLineDetail: { ClassRef: p.costCenter as string } }
        : {}),
    })),
    TotalAmt: toDecimal(p.totalMinor),
  };
}

export interface QboBill {
  VendorRef: string;
  DocNumber: string;
  CurrencyRef: string;
  TotalAmt: number;
  Links?: { HexProcureInvoiceId: string; PurchaseOrderId?: string }[];
}

export function invoiceEventToQboBill(event: IntegrationEvent): QboBill {
  if (event.type !== "INVOICE_APPROVED") {
    throw new Error(`Expected INVOICE_APPROVED event, got ${event.type}`);
  }
  const p = event.payload;
  const supplier = requireField(p.supplier, "supplier");
  return {
    VendorRef: supplier,
    DocNumber: String(p.invoiceNumber ?? ""),
    CurrencyRef: (p.currency as string) ?? "EUR",
    TotalAmt: toDecimal(p.totalMinor),
    Links: [
      {
        HexProcureInvoiceId: p.invoiceId as string,
        ...(p.purchaseOrderId ? { PurchaseOrderId: p.purchaseOrderId as string } : {}),
      },
    ],
  };
}

function requireField(value: unknown, name: string): string {
  if (!value || typeof value !== "string") {
    throw new Error(`Event payload is missing required field: ${name}`);
  }
  return value;
}
