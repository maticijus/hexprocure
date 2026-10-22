import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { invoiceStatus, poStatus, requisitionStatus } from "@/lib/db/schema";
import { isUuid } from "@/lib/ids";
import { DomainError } from "./p2p/shared";

export const DEFAULT_LIMIT = 50;
export const MAX_LIMIT = 100;

export interface ListQuery {
  status?: string;
  costCenterId?: string;
  supplierId?: string;
  limit: number;
  offset: number;
}

function bad(message: string): never {
  throw new DomainError("VALIDATION", message);
}

function readInt(params: URLSearchParams, name: string, fallback: number, min: number, max: number): number {
  const raw = params.get(name);
  if (raw === null) return fallback;
  const n = Number(raw);
  if (!/^\d+$/.test(raw) || n < min || n > max) bad(`${name} must be an integer between ${min} and ${max}`);
  return n;
}

function readEnum(params: URLSearchParams, name: string, allowed: readonly string[]): string | undefined {
  const raw = params.get(name);
  if (raw === null) return undefined;
  if (!allowed.includes(raw)) bad(`${name} must be one of ${allowed.join(", ")}`);
  return raw;
}

function readUuid(params: URLSearchParams, name: string): string | undefined {
  const raw = params.get(name);
  if (raw === null) return undefined;
  if (!isUuid(raw)) bad(`${name} must be a UUID`);
  return raw;
}

export function parseListQuery(
  url: string,
  kind: "requisition" | "purchase_order" | "invoice",
): ListQuery {
  const params = new URL(url).searchParams;
  const statuses = {
    requisition: requisitionStatus.enumValues,
    purchase_order: poStatus.enumValues,
    invoice: invoiceStatus.enumValues,
  }[kind];
  return {
    status: readEnum(params, "status", statuses),
    costCenterId: kind === "requisition" ? readUuid(params, "costCenterId") : undefined,
    supplierId: kind === "purchase_order" ? readUuid(params, "supplierId") : undefined,
    limit: readInt(params, "limit", DEFAULT_LIMIT, 1, MAX_LIMIT),
    offset: readInt(params, "offset", 0, 0, 1_000_000),
  };
}

export function assertUuid(id: string): void {
  if (!isUuid(id)) bad("id must be a UUID");
}

const eq = (column: string, value: string | undefined) =>
  value === undefined ? sql`` : sql` AND ${sql.raw(column)} = ${value}`;

type Row = Record<string, unknown>;
const num = (v: unknown) => Number(v);

export async function listRequisitions(q: ListQuery) {
  const rows = (
    await db.execute(sql`
      SELECT r.id, r.status, r.currency, r.created_at, r.supplier_id, r.cost_center_id, r.requester_id,
             s.name AS supplier, cc.name AS cost_center,
             COALESCE(SUM(rl.quantity * rl.unit_price_minor), 0) AS total_minor
      FROM requisitions r
      LEFT JOIN suppliers s ON s.id = r.supplier_id
      LEFT JOIN cost_centers cc ON cc.id = r.cost_center_id
      LEFT JOIN requisition_lines rl ON rl.requisition_id = r.id
      WHERE TRUE${eq("r.status::text", q.status)}${eq("r.cost_center_id::text", q.costCenterId)}
      GROUP BY r.id, s.name, cc.name
      ORDER BY r.created_at DESC, r.id
      LIMIT ${q.limit} OFFSET ${q.offset}
    `)
  ).rows as Row[];
  return rows.map((r) => ({
    id: r.id,
    status: r.status,
    currency: r.currency,
    createdAt: r.created_at,
    supplierId: r.supplier_id,
    supplier: r.supplier,
    costCenterId: r.cost_center_id,
    costCenter: r.cost_center,
    requesterId: r.requester_id,
    totalMinor: num(r.total_minor),
  }));
}

export async function getRequisition(id: string) {
  const [h] = (
    await db.execute(sql`
      SELECT r.id, r.status, r.currency, r.created_at, r.requester_id, r.supplier_id, r.cost_center_id,
             s.name AS supplier, c.name AS cost_center, u.name AS requester
      FROM requisitions r
      JOIN suppliers s ON s.id = r.supplier_id
      JOIN cost_centers c ON c.id = r.cost_center_id
      JOIN users u ON u.id = r.requester_id
      WHERE r.id = ${id}`)
  ).rows as Row[];
  if (!h) throw new DomainError("NOT_FOUND", "Requisition not found");
  const lines = (
    await db.execute(sql`
      SELECT id, description, kind, quantity, unit_price_minor FROM requisition_lines
      WHERE requisition_id = ${id} ORDER BY description, id`)
  ).rows as Row[];
  const approvals = (
    await db.execute(sql`
      SELECT a.id, a.sequence, a.approver_role, a.decision, a.comment, a.decided_at, u.name AS decider
      FROM approvals a LEFT JOIN users u ON u.id = a.decided_by_user_id
      WHERE a.requisition_id = ${id} ORDER BY a.sequence`)
  ).rows as Row[];
  const [po] = (
    await db.execute(sql`
      SELECT id FROM purchase_orders WHERE requisition_id = ${id} AND status <> 'CANCELLED' LIMIT 1`)
  ).rows as Row[];
  const mapped = lines.map((l) => ({
    id: l.id,
    description: l.description,
    kind: l.kind,
    quantity: num(l.quantity),
    unitPriceMinor: num(l.unit_price_minor),
  }));
  return {
    id: h.id,
    status: h.status,
    currency: h.currency,
    createdAt: h.created_at,
    requesterId: h.requester_id,
    requester: h.requester,
    supplierId: h.supplier_id,
    supplier: h.supplier,
    costCenterId: h.cost_center_id,
    costCenter: h.cost_center,
    totalMinor: mapped.reduce((sum, l) => sum + l.quantity * l.unitPriceMinor, 0),
    lines: mapped,
    approvals: approvals.map((a) => ({
      id: a.id,
      sequence: num(a.sequence),
      approverRole: a.approver_role,
      decision: a.decision,
      comment: a.comment,
      decidedAt: a.decided_at,
      decidedBy: a.decider,
    })),
    purchaseOrderId: po?.id ?? null,
  };
}

export async function listPurchaseOrders(q: ListQuery) {
  const rows = (
    await db.execute(sql`
      SELECT po.id, po.status, po.currency, po.created_at, po.supplier_id, po.cost_center_id, po.requisition_id,
             s.name AS supplier, cc.name AS cost_center,
             COALESCE(SUM(pl.quantity_ordered * pl.unit_price_minor), 0) AS total_minor
      FROM purchase_orders po
      LEFT JOIN suppliers s ON s.id = po.supplier_id
      LEFT JOIN cost_centers cc ON cc.id = po.cost_center_id
      LEFT JOIN po_lines pl ON pl.purchase_order_id = po.id
      WHERE TRUE${eq("po.status::text", q.status)}${eq("po.supplier_id::text", q.supplierId)}
      GROUP BY po.id, s.name, cc.name
      ORDER BY po.created_at DESC, po.id
      LIMIT ${q.limit} OFFSET ${q.offset}
    `)
  ).rows as Row[];
  return rows.map((r) => ({
    id: r.id,
    status: r.status,
    currency: r.currency,
    createdAt: r.created_at,
    supplierId: r.supplier_id,
    supplier: r.supplier,
    costCenterId: r.cost_center_id,
    costCenter: r.cost_center,
    requisitionId: r.requisition_id,
    totalMinor: num(r.total_minor),
  }));
}

export async function getPurchaseOrder(id: string) {
  const [h] = (
    await db.execute(sql`
      SELECT po.id, po.status, po.currency, po.created_at, po.requisition_id, po.supplier_id, po.cost_center_id,
             s.name AS supplier, c.name AS cost_center
      FROM purchase_orders po
      JOIN suppliers s ON s.id = po.supplier_id
      JOIN cost_centers c ON c.id = po.cost_center_id
      WHERE po.id = ${id}`)
  ).rows as Row[];
  if (!h) throw new DomainError("NOT_FOUND", "Purchase order not found");
  const lines = (
    await db.execute(sql`
      SELECT pl.id, pl.description, pl.kind, pl.quantity_ordered, pl.unit_price_minor,
        COALESCE((SELECT SUM(rl.quantity_received) FROM receipt_lines rl WHERE rl.po_line_id = pl.id), 0) AS received,
        (SELECT COUNT(*) FROM receipt_lines rl WHERE rl.po_line_id = pl.id) AS accepted_count,
        COALESCE((SELECT SUM(il.quantity) FROM invoice_lines il WHERE il.po_line_id = pl.id), 0) AS invoiced_qty,
        COALESCE((SELECT SUM(il.amount_minor) FROM invoice_lines il WHERE il.po_line_id = pl.id), 0) AS invoiced_amount
      FROM po_lines pl WHERE pl.purchase_order_id = ${id} ORDER BY pl.description, pl.id`)
  ).rows as Row[];
  const mapped = lines.map((l) => ({
    id: l.id,
    description: l.description,
    kind: l.kind,
    quantityOrdered: num(l.quantity_ordered),
    unitPriceMinor: num(l.unit_price_minor),
    quantityReceived: num(l.received),
    acceptanceCount: num(l.accepted_count),
    quantityInvoiced: num(l.invoiced_qty),
    amountInvoicedMinor: num(l.invoiced_amount),
  }));
  return {
    id: h.id,
    status: h.status,
    currency: h.currency,
    createdAt: h.created_at,
    requisitionId: h.requisition_id,
    supplierId: h.supplier_id,
    supplier: h.supplier,
    costCenterId: h.cost_center_id,
    costCenter: h.cost_center,
    totalMinor: mapped.reduce((sum, l) => sum + l.quantityOrdered * l.unitPriceMinor, 0),
    lines: mapped,
  };
}

export async function listInvoices(q: ListQuery) {
  const rows = (
    await db.execute(sql`
      SELECT i.id, i.number, i.status, i.created_at, i.supplier_id, i.purchase_order_id, po.currency,
             s.name AS supplier,
             COALESCE(SUM(COALESCE(il.amount_minor, il.quantity * il.unit_price_minor)), 0) AS total_minor
      FROM invoices i
      JOIN purchase_orders po ON po.id = i.purchase_order_id
      LEFT JOIN suppliers s ON s.id = i.supplier_id
      LEFT JOIN invoice_lines il ON il.invoice_id = i.id
      WHERE TRUE${eq("i.status::text", q.status)}
      GROUP BY i.id, s.name, po.currency
      ORDER BY i.created_at DESC, i.id
      LIMIT ${q.limit} OFFSET ${q.offset}
    `)
  ).rows as Row[];
  return rows.map((r) => ({
    id: r.id,
    number: r.number,
    status: r.status,
    currency: r.currency,
    createdAt: r.created_at,
    supplierId: r.supplier_id,
    supplier: r.supplier,
    purchaseOrderId: r.purchase_order_id,
    totalMinor: num(r.total_minor),
  }));
}

export async function getInvoice(id: string) {
  const [h] = (
    await db.execute(sql`
      SELECT i.id, i.number, i.status, i.exceptions, i.created_at, i.purchase_order_id, i.supplier_id,
             po.currency, s.name AS supplier
      FROM invoices i
      JOIN purchase_orders po ON po.id = i.purchase_order_id
      JOIN suppliers s ON s.id = i.supplier_id
      WHERE i.id = ${id}`)
  ).rows as Row[];
  if (!h) throw new DomainError("NOT_FOUND", "Invoice not found");
  const lines = (
    await db.execute(sql`
      SELECT il.id, il.po_line_id, pl.description, pl.kind, il.quantity, il.unit_price_minor, il.amount_minor
      FROM invoice_lines il LEFT JOIN po_lines pl ON pl.id = il.po_line_id
      WHERE il.invoice_id = ${id} ORDER BY pl.description, il.id`)
  ).rows as Row[];
  const mapped = lines.map((l) => {
    const quantity = num(l.quantity);
    const unitPriceMinor = num(l.unit_price_minor);
    const amountMinor = l.amount_minor === null ? null : num(l.amount_minor);
    return {
      id: l.id,
      poLineId: l.po_line_id,
      description: l.description,
      kind: l.kind,
      quantity,
      unitPriceMinor,
      amountMinor,
      lineTotalMinor: amountMinor ?? quantity * unitPriceMinor,
    };
  });
  return {
    id: h.id,
    number: h.number,
    status: h.status,
    currency: h.currency,
    createdAt: h.created_at,
    supplierId: h.supplier_id,
    supplier: h.supplier,
    purchaseOrderId: h.purchase_order_id,
    totalMinor: mapped.reduce((sum, l) => sum + l.lineTotalMinor, 0),
    exceptions: h.exceptions,
    lines: mapped,
  };
}
