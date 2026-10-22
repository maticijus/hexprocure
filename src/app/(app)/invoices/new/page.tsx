import { sql } from "drizzle-orm";
import { InvoiceForm, type PoOption } from "@/components/InvoiceForm";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/session";
import type { PoLineOption } from "@/lib/invoice-draft";

export const dynamic = "force-dynamic";

interface Row {
  id: string; currency: string; supplier_id: string; supplier: string;
  lines: PoLineOption[] | null;
}

export default async function NewInvoicePage() {
  const user = await getCurrentUser();
  if (!user) return null;
  const rows = (await db.execute(sql`
    SELECT po.id, po.currency, po.supplier_id, s.name AS supplier,
      (SELECT json_agg(json_build_object(
          'id', pl.id, 'description', pl.description, 'kind', pl.kind,
          'quantityOrdered', pl.quantity_ordered, 'unitPriceMinor', pl.unit_price_minor) ORDER BY pl.description)
       FROM po_lines pl WHERE pl.purchase_order_id = po.id) AS lines
    FROM purchase_orders po JOIN suppliers s ON s.id = po.supplier_id
    WHERE po.status <> 'CANCELLED'
    ORDER BY po.created_at DESC`)).rows as unknown as Row[];
  const pos: PoOption[] = rows.map((r) => ({
    id: r.id,
    label: `${r.supplier} (${r.id.slice(0, 8)})`,
    supplierId: r.supplier_id,
    currency: r.currency,
    lines: r.lines ?? [],
  }));
  return (
    <div className="max-w-3xl">
      <h1 className="text-xl font-bold mb-6">New invoice</h1>
      <InvoiceForm pos={pos} />
    </div>
  );
}
