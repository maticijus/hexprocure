import { getCurrentUser } from "@/lib/session";
import { formatMoney } from "@/lib/format";
import { spendByGroup, type AnalyticsGroupBy } from "@/lib/services/analytics";

export const dynamic = "force-dynamic";


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

  const rows = (await spendByGroup({ groupBy: validBy as AnalyticsGroupBy })).sort(
    (x, y) => x.currency.localeCompare(y.currency) || y.totalMinor - x.totalMinor,
  );

  const maxByCurrency = new Map<string, number>();
  for (const r of rows) {
    maxByCurrency.set(r.currency, Math.max(maxByCurrency.get(r.currency) ?? 1, r.totalMinor));
  }
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
          <div key={`${r.key}|${r.currency}`}>
            <div className="flex justify-between text-sm mb-1">
              <span className="font-medium">{r.key}</span>
              <span className="text-gray-500">
                {formatMoney(r.totalMinor, r.currency)} · {r.documentCount} inv
              </span>
            </div>
            <div className="h-2.5 rounded-full bg-gray-100 overflow-hidden">
              <div
                className="h-full rounded-full bg-[var(--brand)]"
                style={{ width: `${(r.totalMinor / (maxByCurrency.get(r.currency) ?? 1)) * 100}%` }}
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
            <tr key={`${r.key}|${r.currency}`} className="border-t border-gray-50">
              <td className="px-5 py-3 font-medium">{r.key}</td>
              <td className="px-5 py-3">{formatMoney(r.totalMinor, r.currency)}</td>
              <td className="px-5 py-3">{r.documentCount}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
