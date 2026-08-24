import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/session";

export const dynamic = "force-dynamic";

function eur(minor: number) {
  return `€${(minor / 100).toLocaleString("de-DE", { minimumFractionDigits: 2 })}`;
}

export default async function AnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<{ by?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user || (user.role !== "FINANCE" && user.role !== "ADMIN")) {
    return (
      <div>
        <h1 className="text-xl font-bold mb-6">Analytics</h1>
        <p className="rounded-xl bg-white p-6 shadow-sm border border-gray-100 text-gray-500">
          Spend analytics are available to FINANCE and ADMIN roles.
        </p>
      </div>
    );
  }

  const { by = "supplier" } = await searchParams;
  const validBy = ["supplier", "costCenter", "month"].includes(by) ? by : "supplier";

  const rows = (
    await db.execute(sql`
      SELECT ${sql.raw(validBy === "supplier" ? "s.name" : validBy === "costCenter" ? "cc.name" : "to_char(i.created_at,'YYYY-MM')")} AS key,
             COALESCE(SUM(il.quantity * il.unit_price_minor),0)::int AS total_minor,
             COUNT(DISTINCT i.id)::int AS document_count
      FROM invoices i
      LEFT JOIN suppliers s ON s.id = i.supplier_id
      LEFT JOIN purchase_orders po ON po.id = i.purchase_order_id
      LEFT JOIN cost_centers cc ON cc.id = po.cost_center_id
      LEFT JOIN invoice_lines il ON il.invoice_id = i.id
      WHERE i.status = 'APPROVED'
      GROUP BY 1
      ORDER BY total_minor DESC
    `)
  ).rows as { key: string; total_minor: number; document_count: number }[];

  const max = Math.max(1, ...rows.map((r) => Number(r.total_minor)));
  const label = validBy === "supplier" ? "Supplier" : validBy === "costCenter" ? "Cost center" : "Month";
  const link = (b: string, label: string) => (
    <a
      href={`/analytics?by=${b}`}
      className={`px-3 py-1.5 rounded-lg text-sm font-medium ${validBy === b ? "bg-[var(--brand)] text-white" : "bg-white border border-gray-200 text-gray-600 hover:bg-gray-50"}`}
    >
      {label}
    </a>
  );

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-bold">Spend Analytics</h1>
        <div className="flex gap-2">
          {link("supplier", "Supplier")}
          {link("costCenter", "Cost center")}
          {link("month", "Month")}
        </div>
      </div>

      <div className="rounded-xl bg-white shadow-sm border border-gray-100 p-5 space-y-3">
        {rows.map((r) => (
          <div key={r.key}>
            <div className="flex justify-between text-sm mb-1">
              <span className="font-medium">{r.key}</span>
              <span className="text-gray-500">
                {eur(Number(r.total_minor))} · {r.document_count} inv
              </span>
            </div>
            <div className="h-2.5 rounded-full bg-gray-100 overflow-hidden">
              <div
                className="h-full rounded-full bg-[var(--brand)]"
                style={{ width: `${(Number(r.total_minor) / max) * 100}%` }}
              />
            </div>
          </div>
        ))}
        {rows.length === 0 && (
          <p className="text-center text-gray-400 py-8">No approved invoices yet</p>
        )}
      </div>

      <table className="mt-8 w-full text-sm rounded-xl overflow-hidden shadow-sm border border-gray-100 bg-white">
        <thead>
          <tr className="text-left text-xs uppercase tracking-wide text-gray-500 bg-gray-50">
            <th className="px-5 py-3">{label}</th>
            <th className="px-5 py-3">Approved spend</th>
            <th className="px-5 py-3">Invoices</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key} className="border-t border-gray-50">
              <td className="px-5 py-3 font-medium">{r.key}</td>
              <td className="px-5 py-3">{eur(Number(r.total_minor))}</td>
              <td className="px-5 py-3">{r.document_count}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
