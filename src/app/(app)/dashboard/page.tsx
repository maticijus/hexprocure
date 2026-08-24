import Link from "next/link";
import { eq as eq_, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/session";
import {
  requisitions,
  purchaseOrders,
  invoices,
  budgets,
  costCenters,
} from "@/lib/db/schema";

export const dynamic = "force-dynamic";

const STATUS_STYLES: Record<string, string> = {
  DRAFT: "bg-gray-100 text-gray-700",
  SUBMITTED: "bg-blue-50 text-blue-700",
  APPROVED: "bg-green-50 text-green-700",
  REJECTED: "bg-red-50 text-red-700",
  OPEN: "bg-blue-50 text-blue-700",
  CLOSED: "bg-gray-100 text-gray-600",
  CANCELLED: "bg-red-50 text-red-700",
  MATCHED: "bg-green-50 text-green-700",
  EXCEPTION: "bg-amber-50 text-amber-700",
};

function StatusPill({ status }: { status: string }) {
  return (
    <span
      className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold ${STATUS_STYLES[status] ?? "bg-gray-100"}`}
    >
      {status}
    </span>
  );
}

function eur(minor: number) {
  return `€${(minor / 100).toLocaleString("de-DE", { minimumFractionDigits: 2 })}`;
}

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

  const recentReqs = await db
    .select({
      id: requisitions.id,
      status: requisitions.status,
      currency: requisitions.currency,
      createdAt: requisitions.createdAt,
      supplier: { name: sql<string>`s.name` },
      totalMinor: sql<number>`COALESCE(SUM(${sql.raw("rl.quantity * rl.unit_price_minor")}), 0)`,
    })
    .from(requisitions)
    .leftJoin(sql`suppliers s`, sql`s.id = ${requisitions.supplierId}`)
    .leftJoin(sql`requisition_lines rl`, sql`rl.requisition_id = ${requisitions.id}`)
    .groupBy(requisitions.id)
    .orderBy(sql`${requisitions.createdAt} DESC`)
    .limit(6);

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
    { label: "Monthly Budget", value: eur(Number(counts?.budget_minor ?? 0)), accent: "" },
    { label: "Reserved This Month", value: eur(Number(counts?.reserved_minor ?? 0)), accent: "" },
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
                <td className="px-5 py-3 font-medium">{r.supplier?.name ?? "—"}</td>
                <td className="px-5 py-3">{eur(Number(r.totalMinor))}</td>
                <td className="px-5 py-3"><StatusPill status={r.status} /></td>
                <td className="px-5 py-3 text-gray-500">
                  {new Date(r.createdAt).toLocaleDateString("en-GB")}
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
