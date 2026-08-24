import { sql } from "drizzle-orm";
import { db } from "@/lib/db";

export type AnalyticsGroupBy = "supplier" | "costCenter" | "month";

export interface SpendRow {
  key: string;
  totalMinor: number;
  documentCount: number;
}

const GROUP_EXPRESSION: Record<AnalyticsGroupBy, string> = {
  supplier: "s.name",
  costCenter: "cc.name",
  month: "to_char(i.created_at, 'YYYY-MM')",
};

function buildQuery(groupBy: AnalyticsGroupBy, from?: string, to?: string): string {
  const expr = GROUP_EXPRESSION[groupBy];
  const conditions = ["i.status = 'APPROVED'"];
  if (from) conditions.push(`i.created_at >= '${from} 00:00:00'::timestamptz`);
  if (to) conditions.push(`i.created_at <= ('${to} 23:59:59')::timestamptz`);
  const where = conditions.join(" AND ");
  return `
    SELECT ${expr} AS key,
           COALESCE(SUM(il.quantity * il.unit_price_minor), 0)::int AS total_minor,
           COUNT(DISTINCT i.id)::int AS document_count
    FROM invoices i
    LEFT JOIN suppliers s ON s.id = i.supplier_id
    LEFT JOIN cost_centers cc ON cc.id = (
      SELECT po.cost_center_id FROM purchase_orders po WHERE po.id = i.purchase_order_id
    )
    LEFT JOIN invoice_lines il ON il.invoice_id = i.id
    WHERE ${where}
    GROUP BY ${expr}
    ORDER BY total_minor DESC
  `;
}

export async function spendByGroup(opts: {
  groupBy: AnalyticsGroupBy;
  from?: string;
  to?: string;
}): Promise<SpendRow[]> {
  const result = await db.execute(sql.raw(buildQuery(opts.groupBy, opts.from, opts.to)));
  return (result.rows as { key: string | null; total_minor: number; document_count: number }[])
    .filter((r) => r.key !== null)
    .map((r) => ({
      key: r.key as string,
      totalMinor: Number(r.total_minor),
      documentCount: Number(r.document_count),
    }));
}

export interface AnalyticsSummary {
  approvedTotalMinor: number;
  invoiceCount: number;
  topSupplier: { key: string; totalMinor: number } | null;
}

export async function analyticsSummary(): Promise<AnalyticsSummary> {
  const [totals] = (
    await db.execute(sql`
      SELECT COALESCE(SUM(quantity * unit_price_minor), 0)::int AS approved_total,
             COUNT(DISTINCT invoice_id)::int AS invoice_count
      FROM invoice_lines il
      JOIN invoices i ON i.id = il.invoice_id
      WHERE i.status = 'APPROVED'
    `)
  ).rows as { approved_total: number; invoice_count: number }[];

  const top = (await spendByGroup({ groupBy: "supplier" }))[0] ?? null;

  return {
    approvedTotalMinor: Number(totals?.approved_total ?? 0),
    invoiceCount: Number(totals?.invoice_count ?? 0),
    topSupplier: top ? { key: top.key, totalMinor: top.totalMinor } : null,
  };
}
