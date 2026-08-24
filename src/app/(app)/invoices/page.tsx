import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/session";

export const dynamic = "force-dynamic";

const STATUS_STYLES: Record<string, string> = {
  PENDING: "bg-gray-100 text-gray-700",
  MATCHED: "bg-green-50 text-green-700",
  EXCEPTION: "bg-amber-50 text-amber-700",
  APPROVED: "bg-emerald-50 text-emerald-700",
};

export default async function InvoicesPage() {
  await getCurrentUser();
  const rows = (
    await db.execute(sql`
      SELECT i.id, i.number, i.status, s.name AS supplier,
             COALESCE(SUM(il.quantity * il.unit_price_minor),0) AS total_minor
      FROM invoices i
      LEFT JOIN suppliers s ON s.id = i.supplier_id
      LEFT JOIN invoice_lines il ON il.invoice_id = i.id
      GROUP BY i.id ORDER BY i.created_at DESC
    `)
  ).rows as { id: string; number: string; status: string; supplier: string; total_minor: string }[];

  return (
    <div>
      <h1 className="text-xl font-bold mb-6">Invoices</h1>
      <div className="rounded-xl bg-white shadow-sm border border-gray-100 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wide text-gray-500 bg-gray-50">
              <th className="px-5 py-3">Number</th>
              <th className="px-5 py-3">Supplier</th>
              <th className="px-5 py-3">Total</th>
              <th className="px-5 py-3">Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-t border-gray-50 hover:bg-gray-50/60">
                <td className="px-5 py-3 font-medium">{r.number}</td>
                <td className="px-5 py-3">{r.supplier ?? "—"}</td>
                <td className="px-5 py-3">€{(Number(r.total_minor) / 100).toLocaleString("de-DE", { minimumFractionDigits: 2 })}</td>
                <td className="px-5 py-3">
                  <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold ${STATUS_STYLES[r.status] ?? ""}`}>{r.status}</span>
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr><td colSpan={4} className="px-5 py-8 text-center text-gray-400">No invoices yet</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
