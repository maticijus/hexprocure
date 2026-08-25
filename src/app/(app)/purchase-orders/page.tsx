import { sql } from "drizzle-orm";
import { StatusPill, formatEur } from "@/components/ui";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/session";
import { PoRowActions } from "@/components/PoRowActions";

export const dynamic = "force-dynamic";

export default async function PurchaseOrdersPage() {
  const user = await getCurrentUser();
  if (!user) return null;
  const canSend = user.role === "FINANCE" || user.role === "ADMIN";

  const rows = (
    await db.execute(sql`
      SELECT po.id, po.status, po.created_at, s.name AS supplier,
             COALESCE(SUM(pl.quantity_ordered * pl.unit_price_minor),0) AS total_minor,
             COUNT(pl.id) FILTER (WHERE pl.kind = 'SERVICE') AS service_count
      FROM purchase_orders po
      LEFT JOIN suppliers s ON s.id = po.supplier_id
      LEFT JOIN po_lines pl ON pl.purchase_order_id = po.id
      GROUP BY po.id, s.name ORDER BY po.created_at DESC
    `)
  ).rows as {
    id: string; status: string; created_at: string; supplier: string;
    total_minor: string; service_count: number;
  }[];

  return (
    <div>
      <h1 className="text-xl font-bold mb-6">Purchase Orders</h1>
      <div className="rounded-xl bg-white shadow-sm border border-gray-100 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wide text-gray-500 bg-gray-50">
              <th className="px-5 py-3">PO</th>
              <th className="px-5 py-3">Supplier</th>
              <th className="px-5 py-3">Total</th>
              <th className="px-5 py-3">Status</th>
              <th className="px-5 py-3">Documents &amp; Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-t border-gray-50 hover:bg-gray-50/60">
                <td className="px-5 py-3 font-mono text-xs">{r.id.slice(0, 8)}…</td>
                <td className="px-5 py-3 font-medium">{r.supplier ?? "—"}</td>
                <td className="px-5 py-3">{formatEur(Number(r.total_minor))}</td>
                <td className="px-5 py-3">
                  <StatusPill status={r.status} />
                  {Number(r.service_count) > 0 && (
                    <span className="ml-2 inline-block rounded-full px-2 py-0.5 text-xs font-semibold bg-purple-50 text-purple-700">
                      services
                    </span>
                  )}
                </td>
                <td className="px-5 py-3">
                  <PoRowActions
                    poId={r.id}
                    status={r.status}
                    hasServices={Number(r.service_count) > 0}
                    canSend={canSend}
                  />
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr><td colSpan={5} className="px-5 py-8 text-center text-gray-400">No purchase orders yet</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
