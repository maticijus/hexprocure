import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/session";

export default async function SuppliersPage() {
  await getCurrentUser();
  const rows = (await db.execute(sql`SELECT id, name, email FROM suppliers ORDER BY name`)).rows as {
    id: string; name: string; email: string | null;
  }[];
  return (
    <div>
      <h1 className="text-xl font-bold mb-6">Suppliers</h1>
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
                <td className="px-5 py-3 font-medium">{s.name}</td>
                <td className="px-5 py-3 text-gray-500">{s.email ?? "—"}</td>
                <td className="px-5 py-3">
                  <span className="inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold bg-green-50 text-green-700">ACTIVE</span>
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
