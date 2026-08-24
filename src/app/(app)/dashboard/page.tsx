import Link from "next/link";
import { StatusPill, formatEur } from "@/components/ui";
import { eq as eq_, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/session";
import { QboStatusCard } from "@/components/QboStatusCard";
import {


  budgets,
  costCenters,
} from "@/lib/db/schema";

export const dynamic = "force-dynamic";




export default async function DashboardPage() {
  const user = await getCurrentUser();
  if (!user) return null;

  const month = new Date().toISOString().slice(0, 7);
  const [counts] = (await db.execute(sql`
    SELECT
      (SELECT COUNT(*) FROM requisitions WHERE status IN ('DRAFT','SUBMITTED')) AS open_reqs,
      (SELECT COALESCE(SUM(budgeted_minor),0) FROM budgets WHERE year_month = ${month}) AS budget_minor,
      (SELECT COALESCE(SUM(amount_minor),0) FROM budget_reservations) AS reserved_minor,
      (SELECT COUNT(*) FROM invoices WHERE status = 'EXCEPTION') AS exception_invoices
  `).then((r) => r.rows)) as {
    open_reqs: number; budget_minor: string; reserved_minor: string; exception_invoices: number;
  }[];

  const recentReqs = (
    await db.execute(sql`
      SELECT r.id, r.status, r.created_at,
             s.name AS supplier_name,
             COALESCE(SUM(rl.quantity * rl.unit_price_minor), 0) AS total_minor
      FROM requisitions r
      LEFT JOIN suppliers s ON s.id = r.supplier_id
      LEFT JOIN requisition_lines rl ON rl.requisition_id = r.id
      GROUP BY r.id, s.name
      ORDER BY r.created_at DESC
      LIMIT 6
    `)
  ).rows as {
    id: string; status: string; created_at: string; supplier_name: string | null; total_minor: string;
  }[];

  const [budget] = await db
    .select({ cc: costCenters.name, minor: budgets.budgetedMinor })
    .from(budgets)
    .innerJoin(costCenters, eq_(costCenters.id, budgets.costCenterId))
    .where(sql`${budgets.yearMonth} = ${month}`)
    .limit(1);

  const usedPct =
    counts && Number(counts.budget_minor) > 0
      ? Math.min(100, Math.round((Number(counts.reserved_minor) / Number(counts.budget_minor)) * 100))
      : 0;

  const cards = [
    { label: "Open Requisitions", value: String(counts?.open_reqs ?? 0), accent: "text-[var(--brand)]" },
    { label: "Monthly Budget", value: formatEur(Number(counts?.budget_minor ?? 0)), accent: "" },
    { label: "Reserved This Month", value: formatEur(Number(counts?.reserved_minor ?? 0)), accent: "" },
    { label: "Invoice Exceptions", value: String(counts?.exception_invoices ?? 0), accent: "text-amber-600" },
  ];

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold">Welcome back, {user.name.split(" ")[0]}</h1>
          <p className="text-sm text-gray-500">Spend overview for {month}</p>
        </div>
        <Link
          href="/requisitions/new"
          className="rounded-lg bg-[var(--brand)] px-4 py-2 text-sm font-semibold text-white hover:bg-[var(--brand-dark)]"
        >
          + New Requisition
        </Link>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 mb-8">
        {cards.map((c) => (
          <div key={c.label} className="rounded-xl bg-white p-5 shadow-sm border border-gray-100">
            <div className="text-xs font-medium uppercase tracking-wide text-gray-500">{c.label}</div>
            <div className={`mt-2 text-2xl font-bold ${c.accent}`}>{c.value}</div>
          </div>
        ))}
      </div>

      {(user.role === "FINANCE" || user.role === "ADMIN") && <QboStatusCard isAdmin={user.role === "ADMIN"} />}

      {budget && (
        <div className="rounded-xl bg-white p-5 shadow-sm border border-gray-100 mb-8">
          <div className="flex justify-between text-sm mb-2">
            <span className="font-medium">Budget utilization — {budget.cc}</span>
            <span className="text-gray-500">{usedPct}%</span>
          </div>
          <div className="h-3 rounded-full bg-gray-100 overflow-hidden">
            <div
              className="h-full rounded-full bg-[var(--brand)] transition-all"
              style={{ width: `${usedPct}%` }}
            />
          </div>
        </div>
      )}

      <div className="rounded-xl bg-white shadow-sm border border-gray-100 overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
          <h2 className="font-semibold">Recent Requisitions</h2>
          <Link href="/requisitions" className="text-sm text-[var(--brand)] hover:underline">
            View all →
          </Link>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wide text-gray-500 bg-gray-50">
              <th className="px-5 py-3">Supplier</th>
              <th className="px-5 py-3">Total</th>
              <th className="px-5 py-3">Status</th>
              <th className="px-5 py-3">Created</th>
            </tr>
          </thead>
          <tbody>
            {recentReqs.map((r) => (
              <tr key={r.id} className="border-t border-gray-50 hover:bg-gray-50/60">
                <td className="px-5 py-3 font-medium">{r.supplier_name ?? "—"}</td>
                <td className="px-5 py-3">{formatEur(Number(r.total_minor))}</td>
                <td className="px-5 py-3"><StatusPill status={r.status} /></td>
                <td className="px-5 py-3 text-gray-500">
                  {new Date(r.created_at).toLocaleDateString("en-GB")}
                </td>
              </tr>
            ))}
            {recentReqs.length === 0 && (
              <tr><td colSpan={4} className="px-5 py-8 text-center text-gray-400">No requisitions yet</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
