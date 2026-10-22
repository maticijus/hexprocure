import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { DomainError } from "@/lib/services/p2p";

export type AnalyticsGroupBy = "supplier" | "costCenter" | "month";

export interface SpendRow {
  key: string;
  currency: string;
  totalMinor: number;
  documentCount: number;
}

function groupExpression(groupBy: AnalyticsGroupBy): string {
  switch (groupBy) {
    case "supplier":
      return "s.name";
    case "costCenter":
      return "cc.name";
    case "month":
      return "to_char(i.created_at, 'YYYY-MM')";
    default:
      throw new DomainError("VALIDATION", "groupBy must be supplier, costCenter, or month");
  }
}

function assertDate(label: string, value: string | undefined): void {
  if (value === undefined) return;
  const parsed = new Date(`${value}T00:00:00Z`);
  const valid =
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    !Number.isNaN(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === value;
  if (!valid) throw new DomainError("VALIDATION", `${label} must be a valid YYYY-MM-DD date`);
}

// Only the allowlisted group expression is raw SQL; dates are bound parameters.
function buildQuery(groupBy: AnalyticsGroupBy, from?: string, to?: string) {
  const expr = sql.raw(groupExpression(groupBy));
  const fromCond = from ? sql`AND i.created_at >= (${from} || ' 00:00:00')::timestamptz` : sql``;
  const toCond = to ? sql`AND i.created_at <= (${to} || ' 23:59:59')::timestamptz` : sql``;
  return sql`
    SELECT ${expr} AS key,
           po.currency AS currency,
           COALESCE(SUM(il.quantity * il.unit_price_minor), 0)::int AS total_minor,
           COUNT(DISTINCT i.id)::int AS document_count
    FROM invoices i
    LEFT JOIN suppliers s ON s.id = i.supplier_id
    JOIN purchase_orders po ON po.id = i.purchase_order_id
    LEFT JOIN cost_centers cc ON cc.id = po.cost_center_id
    LEFT JOIN invoice_lines il ON il.invoice_id = i.id
    WHERE i.status = 'APPROVED' ${fromCond} ${toCond}
    GROUP BY ${expr}, po.currency
    ORDER BY total_minor DESC
  `;
}

export async function spendByGroup(opts: {
  groupBy: AnalyticsGroupBy;
  from?: string;
  to?: string;
}): Promise<SpendRow[]> {
  assertDate("from", opts.from);
  assertDate("to", opts.to);
  const result = await db.execute(buildQuery(opts.groupBy, opts.from, opts.to));
  return (result.rows as { key: string | null; currency: string; total_minor: number; document_count: number }[])
    .filter((r) => r.key !== null)
    .map((r) => ({
      key: r.key as string,
      currency: r.currency,
      totalMinor: Number(r.total_minor),
      documentCount: Number(r.document_count),
    }));
}

export interface CurrencyTotal {
  currency: string;
  totalMinor: number;
  invoiceCount: number;
}

export interface AnalyticsSummary {
  totals: CurrencyTotal[];
  topSuppliers: { key: string; currency: string; totalMinor: number }[];
}

export async function analyticsSummary(): Promise<AnalyticsSummary> {
  const totals = (
    await db.execute(sql`
      SELECT po.currency AS currency,
             COALESCE(SUM(il.quantity * il.unit_price_minor), 0)::int AS total_minor,
             COUNT(DISTINCT i.id)::int AS invoice_count
      FROM invoices i
      JOIN purchase_orders po ON po.id = i.purchase_order_id
      LEFT JOIN invoice_lines il ON il.invoice_id = i.id
      WHERE i.status = 'APPROVED'
      GROUP BY po.currency
      ORDER BY po.currency
    `)
  ).rows as { currency: string; total_minor: number; invoice_count: number }[];

  const bySupplier = await spendByGroup({ groupBy: "supplier" });
  const topSuppliers = totals.flatMap((t) => {
    const top = bySupplier.find((r) => r.currency === t.currency);
    return top ? [{ key: top.key, currency: top.currency, totalMinor: top.totalMinor }] : [];
  });

  return {
    totals: totals.map((t) => ({
      currency: t.currency,
      totalMinor: Number(t.total_minor),
      invoiceCount: Number(t.invoice_count),
    })),
    topSuppliers,
  };
}
