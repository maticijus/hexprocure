import { ArchiveButton } from "@/components/admin/ArchiveButton";
import { MasterDataForm, type FieldSpec } from "@/components/admin/MasterDataForm";
import { NoAccess, userWithRole } from "@/components/admin/AdminFrame";
import { ActivePill, Card, TABLE_HEAD } from "@/components/ui";
import { SUPPORTED_CURRENCIES, formatMoney, toMajorUnitsInput } from "@/lib/format";
import { APPROVER_ROLES, listApprovalRules } from "@/lib/services/master-data/approval-rules";

export const dynamic = "force-dynamic";

const ROLE_LABEL: Record<string, string> = { MANAGER: "A manager", FINANCE: "Finance", ADMIN: "An admin" };

const FIELDS: FieldSpec[] = [
  { name: "minMinor", label: "From amount", kind: "money", required: true, hint: "Requisitions of at least this total." },
  { name: "maxMinor", label: "Up to amount", kind: "money", hint: "Leave empty for no upper limit: this step then applies to every larger total too." },
  {
    name: "approverRole",
    label: "Approved by",
    kind: "select",
    required: true,
    options: APPROVER_ROLES.map((r) => ({ value: r, label: ROLE_LABEL[r] })),
  },
  { name: "currency", label: "Currency", kind: "select", required: true, options: SUPPORTED_CURRENCIES.map((c) => ({ value: c, label: c })) },
  { name: "sequence", label: "Step number", kind: "number", hint: "Optional. New rules go last." },
];

export default async function AdminApprovalRulesPage({ searchParams }: { searchParams: Promise<{ edit?: string }> }) {
  const user = await userWithRole(["ADMIN"]);
  if (!user) return <NoAccess title="Manage approval rules" who="Admin users" />;
  const { edit } = await searchParams;
  const rows = await listApprovalRules({ includeArchived: true });
  const editing = rows.find((r) => r.id === edit && !r.archivedAt);

  return (
    <div>
      <h1 className="text-xl font-bold mb-2">Manage approval rules</h1>
      <p className="text-sm text-gray-500 mb-6">
        A requisition is approved by the rule whose amount range contains its total. Ranges with an upper limit may
        touch but not overlap. Rules without an upper limit add an extra approval step for every larger total.
      </p>
      {editing ? (
        <MasterDataForm
          key={editing.id}
          title={`Edit step ${editing.sequence}`}
          path={`/api/v1/approval-rules/${editing.id}`}
          method="PATCH"
          fields={FIELDS}
          initial={{
            minMinor: toMajorUnitsInput(editing.minMinor, editing.currency),
            maxMinor: editing.maxMinor === null ? "" : toMajorUnitsInput(editing.maxMinor, editing.currency),
            approverRole: editing.approverRole,
            currency: editing.currency,
            sequence: String(editing.sequence),
          }}
          submitLabel="Save changes"
          doneHref="/admin/approval-rules"
        />
      ) : (
        <MasterDataForm
          title="Add an approval rule"
          path="/api/v1/approval-rules"
          method="POST"
          fields={FIELDS}
          initial={{ currency: "EUR" }}
          submitLabel="Add rule"
          doneHref="/admin/approval-rules"
        />
      )}
      <Card title="Approval rules">
        <table className="w-full text-sm">
          <thead>
            <tr className={TABLE_HEAD}>
              <th className="px-5 py-3">Step</th>
              <th className="px-5 py-3">Amount range</th>
              <th className="px-5 py-3">Approved by</th>
              <th className="px-5 py-3">Status</th>
              <th className="px-5 py-3" />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-t border-gray-50">
                <td className="px-5 py-3 font-medium">{r.sequence}</td>
                <td className="px-5 py-3">
                  {formatMoney(r.minMinor, r.currency)}
                  {r.maxMinor === null ? " and more" : ` to ${formatMoney(r.maxMinor, r.currency)}`}
                </td>
                <td className="px-5 py-3">{ROLE_LABEL[r.approverRole] ?? r.approverRole}</td>
                <td className="px-5 py-3"><ActivePill archived={!!r.archivedAt} /></td>
                <td className="px-5 py-3 text-right space-x-4">
                  {!r.archivedAt && <a href={`/admin/approval-rules?edit=${r.id}`} className="text-sm font-semibold text-[var(--brand)] hover:underline">Edit</a>}
                  {!r.archivedAt && <ArchiveButton path={`/api/v1/approval-rules/${r.id}/archive`} />}
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr><td colSpan={5} className="px-5 py-8 text-center text-gray-400">No approval rules yet</td></tr>
            )}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
