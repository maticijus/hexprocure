import { ArchiveButton } from "@/components/admin/ArchiveButton";
import { CsvUpload } from "@/components/admin/CsvUpload";
import { MasterDataForm, type FieldSpec } from "@/components/admin/MasterDataForm";
import { NoAccess, userWithRole } from "@/components/admin/AdminFrame";
import { ActivePill, Card, TABLE_HEAD } from "@/components/ui";
import { listCostCenters } from "@/lib/services/master-data/cost-centers";

export const dynamic = "force-dynamic";

const FIELDS: FieldSpec[] = [{ name: "name", label: "Name", kind: "text", required: true }];

export default async function AdminCostCentersPage({ searchParams }: { searchParams: Promise<{ edit?: string }> }) {
  const user = await userWithRole(["ADMIN"]);
  if (!user) return <NoAccess title="Manage cost centers" who="Admin users" />;
  const { edit } = await searchParams;
  const rows = await listCostCenters({ includeArchived: true });
  const editing = rows.find((c) => c.id === edit && !c.archivedAt);

  return (
    <div>
      <h1 className="text-xl font-bold mb-6">Manage cost centers</h1>
      {editing ? (
        <MasterDataForm
          key={editing.id}
          title={`Rename ${editing.name}`}
          path={`/api/v1/cost-centers/${editing.id}`}
          method="PATCH"
          fields={FIELDS}
          initial={{ name: editing.name }}
          submitLabel="Save changes"
          doneHref="/admin/cost-centers"
        />
      ) : (
        <MasterDataForm title="Add a cost center" path="/api/v1/cost-centers" method="POST" fields={FIELDS} submitLabel="Add cost center" doneHref="/admin/cost-centers" />
      )}
      <CsvUpload path="/api/v1/cost-centers/import" header="name" />
      <Card title="Cost centers">
        <table className="w-full text-sm">
          <thead>
            <tr className={TABLE_HEAD}>
              <th className="px-5 py-3">Name</th>
              <th className="px-5 py-3">Status</th>
              <th className="px-5 py-3" />
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => (
              <tr key={c.id} className="border-t border-gray-50">
                <td className="px-5 py-3 font-medium">{c.name}</td>
                <td className="px-5 py-3"><ActivePill archived={!!c.archivedAt} /></td>
                <td className="px-5 py-3 text-right space-x-4">
                  {!c.archivedAt && <a href={`/admin/cost-centers?edit=${c.id}`} className="text-sm font-semibold text-[var(--brand)] hover:underline">Rename</a>}
                  {!c.archivedAt && <ArchiveButton path={`/api/v1/cost-centers/${c.id}/archive`} />}
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr><td colSpan={3} className="px-5 py-8 text-center text-gray-400">No cost centers yet</td></tr>
            )}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
