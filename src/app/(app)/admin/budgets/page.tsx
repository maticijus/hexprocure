import { ArchiveButton } from "@/components/admin/ArchiveButton";
import { MasterDataForm, type FieldSpec } from "@/components/admin/MasterDataForm";
import { NoAccess, userWithRole } from "@/components/admin/AdminFrame";
import { ActivePill, Card, TABLE_HEAD } from "@/components/ui";
import { SUPPORTED_CURRENCIES, formatMoney, toMajorUnitsInput } from "@/lib/format";
import { listBudgets } from "@/lib/services/master-data/budgets";
import { listCostCenters } from "@/lib/services/master-data/cost-centers";

export const dynamic = "force-dynamic";

const CURRENCY_OPTIONS = SUPPORTED_CURRENCIES.map((c) => ({ value: c, label: c }));
const AMOUNT: FieldSpec = { name: "budgetedMinor", label: "Amount", kind: "money", required: true };

export default async function AdminBudgetsPage({ searchParams }: { searchParams: Promise<{ edit?: string }> }) {
  const user = await userWithRole(["ADMIN", "FINANCE"]);
  if (!user) return <NoAccess title="Manage budgets" who="Admin and Finance users" />;
  const { edit } = await searchParams;
  const [rows, costCenters] = await Promise.all([
    listBudgets({ includeArchived: true }),
    listCostCenters({ includeArchived: true }),
  ]);
  const ccName = new Map(costCenters.map((c) => [c.id, c.name]));
  const editing = rows.find((b) => b.id === edit && !b.archivedAt);
  const createFields: FieldSpec[] = [
    {
      name: "costCenterId",
      label: "Cost center",
      kind: "select",
      required: true,
      options: costCenters.filter((c) => !c.archivedAt).map((c) => ({ value: c.id, label: c.name })),
    },
    { name: "yearMonth", label: "Month", kind: "month", required: true },
    AMOUNT,
    { name: "currency", label: "Currency", kind: "select", required: true, options: CURRENCY_OPTIONS },
  ];

  return (
    <div>
      <h1 className="text-xl font-bold mb-6">Manage budgets</h1>
      {editing ? (
        <MasterDataForm
          key={editing.id}
          title={`Change the ${editing.yearMonth} budget of ${ccName.get(editing.costCenterId) ?? "this cost center"}`}
          path={`/api/v1/budgets/${editing.id}`}
          method="PATCH"
          fields={[{ ...AMOUNT, label: `Amount (${editing.currency})` }]}
          initial={{ budgetedMinor: toMajorUnitsInput(editing.budgetedMinor, editing.currency), currency: editing.currency }}
          submitLabel="Save changes"
          doneHref="/admin/budgets"
        />
      ) : (
        <MasterDataForm
          title="Add a monthly budget"
          path="/api/v1/budgets"
          method="POST"
          fields={createFields}
          initial={{ currency: "EUR" }}
          submitLabel="Add budget"
          doneHref="/admin/budgets"
        />
      )}
      <Card title="Budgets">
        <table className="w-full text-sm">
          <thead>
            <tr className={TABLE_HEAD}>
              <th className="px-5 py-3">Cost center</th>
              <th className="px-5 py-3">Month</th>
              <th className="px-5 py-3">Amount</th>
              <th className="px-5 py-3">Status</th>
              <th className="px-5 py-3" />
            </tr>
          </thead>
          <tbody>
            {rows.map((b) => (
              <tr key={b.id} className="border-t border-gray-50">
                <td className="px-5 py-3 font-medium">{ccName.get(b.costCenterId) ?? "-"}</td>
                <td className="px-5 py-3">{b.yearMonth}</td>
                <td className="px-5 py-3">{formatMoney(b.budgetedMinor, b.currency)}</td>
                <td className="px-5 py-3"><ActivePill archived={!!b.archivedAt} /></td>
                <td className="px-5 py-3 text-right space-x-4">
                  {!b.archivedAt && <a href={`/admin/budgets?edit=${b.id}`} className="text-sm font-semibold text-[var(--brand)] hover:underline">Change amount</a>}
                  {!b.archivedAt && user.role === "ADMIN" && <ArchiveButton path={`/api/v1/budgets/${b.id}/archive`} />}
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr><td colSpan={5} className="px-5 py-8 text-center text-gray-400">No budgets yet</td></tr>
            )}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
