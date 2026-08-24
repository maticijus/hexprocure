import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/session";
import { ApprovalActions } from "@/components/ApprovalActions";

export const dynamic = "force-dynamic";

export default async function ApprovalsPage() {
  const user = await getCurrentUser();
  if (!user) return null;
  const rows = (
    await db.execute(sql`
      SELECT a.id, a.approver_role, r.id AS req_id, s.name AS supplier,
             COALESCE(SUM(rl.quantity * rl.unit_price_minor),0) AS total_minor
      FROM approvals a
      JOIN requisitions r ON r.id = a.requisition_id
      LEFT JOIN suppliers s ON s.id = r.supplier_id
      LEFT JOIN requisition_lines rl ON rl.requisition_id = r.id
      WHERE a.decision IS NULL
        AND (a.approver_role = ${user.role} OR ${user.role} = 'ADMIN')
      GROUP BY a.id, r.id ORDER BY r.created_at
    `)
  ).rows as { id: string; approver_role: string; req_id: string; supplier: string; total_minor: string }[];

  return (
    <div>
      <h1 className="text-xl font-bold mb-1">Approval Inbox</h1>
      <p className="text-sm text-gray-500 mb-6">Items waiting on your {user.role} action</p>
      <div className="rounded-xl bg-white shadow-sm border border-gray-100 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wide text-gray-500 bg-gray-50">
              <th className="px-5 py-3">Requisition</th>
              <th className="px-5 py-3">Supplier</th>
              <th className="px-5 py-3">Total</th>
              <th className="px-5 py-3">Action</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-t border-gray-50 hover:bg-gray-50/60">
                <td className="px-5 py-3 font-mono text-xs">{r.req_id.slice(0, 8)}…</td>
                <td className="px-5 py-3 font-medium">{r.supplier ?? "—"}</td>
                <td className="px-5 py-3">€{(Number(r.total_minor) / 100).toLocaleString("de-DE", { minimumFractionDigits: 2 })}</td>
                <td className="px-5 py-3"><ApprovalActions approvalId={r.id} /></td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr><td colSpan={4} className="px-5 py-8 text-center text-gray-400">Nothing pending — inbox zero 🎉</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
