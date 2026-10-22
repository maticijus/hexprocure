import { ArchiveButton } from "@/components/admin/ArchiveButton";
import { CsvUpload } from "@/components/admin/CsvUpload";
import { MasterDataForm, type FieldSpec } from "@/components/admin/MasterDataForm";
import { NoAccess, userWithRole } from "@/components/admin/AdminFrame";
import { ActivePill, Card, TABLE_HEAD } from "@/components/ui";
import { listSuppliers } from "@/lib/services/master-data/suppliers";

export const dynamic = "force-dynamic";

const FIELDS: FieldSpec[] = [
  { name: "name", label: "Name", kind: "text", required: true },
  { name: "email", label: "Order email", kind: "email", hint: "Purchase orders are sent here. Optional." },
];

export default async function AdminSuppliersPage({ searchParams }: { searchParams: Promise<{ edit?: string }> }) {
  const user = await userWithRole(["ADMIN", "FINANCE"]);
  if (!user) return <NoAccess title="Manage suppliers" who="Admin and Finance users" />;
  const { edit } = await searchParams;
  const rows = await listSuppliers({ includeArchived: true });
  const editing = rows.find((s) => s.id === edit && !s.archivedAt);

  return (
    <div>
      <h1 className="text-xl font-bold mb-6">Manage suppliers</h1>
      {editing ? (
        <MasterDataForm
          key={editing.id}
          title={`Edit ${editing.name}`}
          path={`/api/v1/suppliers/${editing.id}`}
          method="PATCH"
          fields={FIELDS}
          initial={{ name: editing.name, email: editing.email ?? "" }}
          submitLabel="Save changes"
          doneHref="/admin/suppliers"
        />
      ) : (
        <MasterDataForm title="Add a supplier" path="/api/v1/suppliers" method="POST" fields={FIELDS} submitLabel="Add supplier" doneHref="/admin/suppliers" />
      )}
      {user.role === "ADMIN" && <CsvUpload path="/api/v1/suppliers/import" header="name,email" />}
      <Card title="Suppliers">
        <table className="w-full text-sm">
          <thead>
            <tr className={TABLE_HEAD}>
              <th className="px-5 py-3">Name</th>
              <th className="px-5 py-3">Order email</th>
              <th className="px-5 py-3">Status</th>
              <th className="px-5 py-3" />
            </tr>
          </thead>
          <tbody>
            {rows.map((s) => (
              <tr key={s.id} className="border-t border-gray-50">
                <td className="px-5 py-3 font-medium">{s.name}</td>
                <td className="px-5 py-3 text-gray-500">{s.email ?? "-"}</td>
                <td className="px-5 py-3"><ActivePill archived={!!s.archivedAt} /></td>
                <td className="px-5 py-3 text-right space-x-4">
                  {!s.archivedAt && <a href={`/admin/suppliers?edit=${s.id}`} className="text-sm font-semibold text-[var(--brand)] hover:underline">Edit</a>}
                  {!s.archivedAt && user.role === "ADMIN" && <ArchiveButton path={`/api/v1/suppliers/${s.id}/archive`} />}
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr><td colSpan={4} className="px-5 py-8 text-center text-gray-400">No suppliers yet</td></tr>
            )}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
