import Link from "next/link";
import { notFound } from "next/navigation";
import { sql } from "drizzle-orm";
import { Card, Fact, StatusPill, TABLE_HEAD } from "@/components/ui";
import { PoDetailActions, type GoodsLine, type ServiceLine } from "@/components/PoDetailActions";
import { PoRowActions } from "@/components/PoRowActions";
import { db } from "@/lib/db";
import { formatMoney } from "@/lib/format";
import { isUuid } from "@/lib/ids";
import { getCurrentUser } from "@/lib/session";
import { sumLinesMinor } from "@/lib/ui-text";

export const dynamic = "force-dynamic";

interface Header { status: string; currency: string; supplier: string; cost_center: string; requisition_id: string | null }
interface Line {
  id: string; description: string; kind: "GOODS" | "SERVICE"; quantity_ordered: number; unit_price_minor: number;
  received: string; accepted_count: string; invoiced_qty: string; invoiced_amount: string;
}

async function load(id: string) {
  const [header] = (await db.execute(sql`
    SELECT po.status, po.currency, po.requisition_id, s.name AS supplier, c.name AS cost_center
    FROM purchase_orders po
    JOIN suppliers s ON s.id = po.supplier_id
    JOIN cost_centers c ON c.id = po.cost_center_id
    WHERE po.id = ${id}`)).rows as unknown as Header[];
  if (!header) return null;
  const lines = (await db.execute(sql`
    SELECT pl.id, pl.description, pl.kind, pl.quantity_ordered, pl.unit_price_minor,
      COALESCE((SELECT SUM(rl.quantity_received) FROM receipt_lines rl WHERE rl.po_line_id = pl.id), 0) AS received,
      (SELECT COUNT(*) FROM receipt_lines rl WHERE rl.po_line_id = pl.id) AS accepted_count,
      COALESCE((SELECT SUM(il.quantity) FROM invoice_lines il WHERE il.po_line_id = pl.id), 0) AS invoiced_qty,
      COALESCE((SELECT SUM(il.amount_minor) FROM invoice_lines il WHERE il.po_line_id = pl.id), 0) AS invoiced_amount
    FROM po_lines pl WHERE pl.purchase_order_id = ${id} ORDER BY pl.description`)).rows as unknown as Line[];
  return { header, lines };
}

export default async function PurchaseOrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user || !isUuid(id)) notFound();
  const data = await load(id);
  if (!data) notFound();
  const { header, lines } = data;
  const open = header.status === "OPEN";
  const total = sumLinesMinor(lines.map((l) => ({ quantity: l.quantity_ordered, unitPriceMinor: l.unit_price_minor })));
  const goods: GoodsLine[] = lines
    .filter((l) => l.kind === "GOODS")
    .map((l) => ({ id: l.id, description: l.description, remaining: l.quantity_ordered - Number(l.received) }));
  const services: ServiceLine[] = lines
    .filter((l) => l.kind === "SERVICE")
    .map((l) => ({ id: l.id, description: l.description, accepted: Number(l.accepted_count) > 0 }));
  const canManage = ["MANAGER", "FINANCE", "ADMIN"].includes(user.role);
  const money = (n: number) => formatMoney(n, header.currency);

  return (
    <div>
      <Link href="/purchase-orders" className="text-sm text-gray-500 hover:underline">Purchase orders</Link>
      <div className="flex items-center justify-between my-4">
        <h1 className="text-xl font-bold">Purchase order {id.slice(0, 8)}</h1>
        <span data-testid="status"><StatusPill status={header.status} /></span>
      </div>
      <Card>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 p-5">
          <Fact label="Supplier">{header.supplier}</Fact>
          <Fact label="Cost center">{header.cost_center}</Fact>
          <Fact label="Total">{money(total)}</Fact>
          <Fact label="Requisition">
            {header.requisition_id
              ? <Link href={`/requisitions/${header.requisition_id}`} className="text-[var(--brand)] hover:underline">View</Link>
              : "None"}
          </Fact>
        </div>
        <div className="px-5 pb-5">
          <PoRowActions poId={id} status={header.status} hasServices={false} canSend={user.role === "FINANCE" || user.role === "ADMIN"} />
        </div>
      </Card>
      <Card title="Lines">
        <table className="w-full text-sm">
          <thead><tr className={TABLE_HEAD}>
            <th className="px-5 py-3">Description</th><th className="px-5 py-3">Kind</th>
            <th className="px-5 py-3">Ordered</th><th className="px-5 py-3">Received</th>
            <th className="px-5 py-3">Accepted</th><th className="px-5 py-3">Invoiced</th>
          </tr></thead>
          <tbody>
            {lines.map((l) => {
              const service = l.kind === "SERVICE";
              return (
                <tr key={l.id} className="border-t border-gray-50">
                  <td className="px-5 py-3">{l.description}</td>
                  <td className="px-5 py-3">{l.kind}</td>
                  <td className="px-5 py-3">{service ? money(l.quantity_ordered * l.unit_price_minor) : l.quantity_ordered}</td>
                  <td className="px-5 py-3">{service ? "n/a" : Number(l.received)}</td>
                  <td className="px-5 py-3">{service ? (Number(l.accepted_count) > 0 ? "Yes" : "No") : Number(l.received)}</td>
                  <td className="px-5 py-3">{service ? money(Number(l.invoiced_amount)) : Number(l.invoiced_qty)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>
      <PoDetailActions poId={id} open={open} canCancel={open && canManage} goods={goods} services={services} />
    </div>
  );
}
