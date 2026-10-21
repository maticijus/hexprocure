import Link from "next/link";
import { notFound } from "next/navigation";
import { sql } from "drizzle-orm";
import { Card, Fact, StatusPill, TABLE_HEAD } from "@/components/ui";
import { db } from "@/lib/db";
import { formatMoney } from "@/lib/format";
import { isUuid } from "@/lib/ids";
import { getCurrentUser } from "@/lib/session";

export const dynamic = "force-dynamic";

interface PoRow { id: string; status: string; currency: string; total_minor: string }
interface InvoiceRow { id: string; number: string; status: string }

export default async function SupplierDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user || !isUuid(id)) notFound();
  const [supplier] = (await db.execute(sql`SELECT name, email FROM suppliers WHERE id = ${id}`)).rows as {
    name: string; email: string | null;
  }[];
  if (!supplier) notFound();
  const pos = (await db.execute(sql`
    SELECT po.id, po.status, po.currency, COALESCE(SUM(pl.quantity_ordered * pl.unit_price_minor), 0) AS total_minor
    FROM purchase_orders po LEFT JOIN po_lines pl ON pl.purchase_order_id = po.id
    WHERE po.supplier_id = ${id} AND po.status = 'OPEN'
    GROUP BY po.id ORDER BY po.created_at DESC`)).rows as unknown as PoRow[];
  const invoices = (await db.execute(sql`
    SELECT id, number, status FROM invoices WHERE supplier_id = ${id} ORDER BY created_at DESC`)).rows as unknown as InvoiceRow[];

  return (
    <div>
      <Link href="/suppliers" className="text-sm text-gray-500 hover:underline">Suppliers</Link>
      <h1 className="text-xl font-bold my-4">{supplier.name}</h1>
      <Card>
        <div className="grid grid-cols-2 gap-4 p-5">
          <Fact label="Email">{supplier.email ?? "-"}</Fact>
          <Fact label="Status">Active</Fact>
        </div>
      </Card>
      <Card title="Open purchase orders">
        <table className="w-full text-sm">
          <thead><tr className={TABLE_HEAD}><th className="px-5 py-3">PO</th><th className="px-5 py-3">Total</th></tr></thead>
          <tbody>
            {pos.map((p) => (
              <tr key={p.id} className="border-t border-gray-50">
                <td className="px-5 py-3 font-mono text-xs"><Link href={`/purchase-orders/${p.id}`} className="text-[var(--brand)] hover:underline">{p.id.slice(0, 8)}</Link></td>
                <td className="px-5 py-3">{formatMoney(Number(p.total_minor), p.currency)}</td>
              </tr>
            ))}
            {pos.length === 0 && <tr><td colSpan={2} className="px-5 py-6 text-center text-gray-400">No open purchase orders</td></tr>}
          </tbody>
        </table>
      </Card>
      <Card title="Invoices">
        <table className="w-full text-sm">
          <thead><tr className={TABLE_HEAD}><th className="px-5 py-3">Number</th><th className="px-5 py-3">Status</th></tr></thead>
          <tbody>
            {invoices.map((i) => (
              <tr key={i.id} className="border-t border-gray-50">
                <td className="px-5 py-3"><Link href={`/invoices/${i.id}`} className="text-[var(--brand)] hover:underline">{i.number}</Link></td>
                <td className="px-5 py-3"><StatusPill status={i.status} /></td>
              </tr>
            ))}
            {invoices.length === 0 && <tr><td colSpan={2} className="px-5 py-6 text-center text-gray-400">No invoices</td></tr>}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
