import Link from "next/link";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { ActivePill } from "@/components/ui";
import { getCurrentUser } from "@/lib/session";

export default async function SuppliersPage() {
  const user = await getCurrentUser();
  const canManage = user?.role === "ADMIN" || user?.role === "FINANCE";
  const rows = (await db.execute(sql`SELECT id, name, email, archived_at FROM suppliers ORDER BY name`)).rows as {
    id: string; name: string; email: string | null; archived_at: string | null;
  }[];
  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-bold">Suppliers</h1>
        {canManage && (
          <Link
            href="/admin/suppliers"
            className="rounded-lg bg-[var(--brand)] px-4 py-2 text-sm font-semibold text-white hover:bg-[var(--brand-dark)]"
          >
            Add or edit suppliers
          </Link>
        )}
      </div>
      <div className="rounded-xl bg-white shadow-sm border border-gray-100 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wide text-gray-500 bg-gray-50">
              <th className="px-5 py-3">Name</th>
              <th className="px-5 py-3">Email</th>
              <th className="px-5 py-3">Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((s) => (
              <tr key={s.id} className="border-t border-gray-50 hover:bg-gray-50/60">
                <td className="px-5 py-3 font-medium">
                  <Link href={`/suppliers/${s.id}`} className="text-[var(--brand)] hover:underline">{s.name}</Link>
                </td>
                <td className="px-5 py-3 text-gray-500">{s.email ?? "-"}</td>
                <td className="px-5 py-3">
                  <ActivePill archived={!!s.archived_at} />
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr><td colSpan={3} className="px-5 py-8 text-center text-gray-400">No suppliers yet</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
