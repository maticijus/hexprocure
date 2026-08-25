import { sql } from "drizzle-orm";
import { StatusPill, formatEur } from "@/components/ui";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/session";
import { RequisitionRowActions } from "@/components/RequisitionRowActions";

export const dynamic = "force-dynamic";



export default async function RequisitionsPage() {
  await getCurrentUser();
  const rows = (
    await db.execute(sql`
      SELECT r.id, r.status, r.created_at,
             s.name AS supplier,
             COALESCE(SUM(rl.quantity * rl.unit_price_minor),0) AS total_minor
      FROM requisitions r
      LEFT JOIN suppliers s ON s.id = r.supplier_id
      LEFT JOIN requisition_lines rl ON rl.requisition_id = r.id
      GROUP BY r.id, s.name ORDER BY r.created_at DESC
    `)
  ).rows as { id: string; status: string; created_at: string; supplier: string; total_minor: string }[];

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-bold">Requisitions</h1>
        <a
          href="/requisitions/new"
          className="rounded-lg bg-[var(--brand)] px-4 py-2 text-sm font-semibold text-white hover:bg-[var(--brand-dark)]"
        >
          + New Requisition
        </a>
      </div>
      <div className="rounded-xl bg-white shadow-sm border border-gray-100 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wide text-gray-500 bg-gray-50">
              <th className="px-5 py-3">Supplier</th>
              <th className="px-5 py-3">Total</th>
              <th className="px-5 py-3">Status</th>
              <th className="px-5 py-3">Created</th>
              <th className="px-5 py-3"><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-t border-gray-50 hover:bg-gray-50/60">
                <td className="px-5 py-3 font-medium">{r.supplier ?? "—"}</td>
                <td className="px-5 py-3">{formatEur(Number(r.total_minor))}</td>
                <td className="px-5 py-3">
                  <StatusPill status={r.status} />
                </td>
                <td className="px-5 py-3 text-gray-500">
                  {new Date(r.created_at).toLocaleDateString("en-GB")}
                </td>
                <td className="px-5 py-3">
                  <RequisitionRowActions requisitionId={r.id} status={r.status} />
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr><td colSpan={5} className="px-5 py-8 text-center text-gray-400">No requisitions yet</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
