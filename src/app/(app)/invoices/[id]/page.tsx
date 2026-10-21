import Link from "next/link";
import { notFound } from "next/navigation";
import { sql } from "drizzle-orm";
import { Card, Fact, StatusPill, TABLE_HEAD } from "@/components/ui";
import { InvoiceActions } from "@/components/InvoiceActions";
import { db } from "@/lib/db";
import { formatMoney } from "@/lib/format";
import { isUuid } from "@/lib/ids";
import { getCurrentUser } from "@/lib/session";
import { sumLinesMinor } from "@/lib/ui-text";

export const dynamic = "force-dynamic";

interface Header {
  number: string; status: string; exceptions: ExceptionRow[]; currency: string;
  supplier: string; supplier_id: string; purchase_order_id: string;
}
interface ExceptionRow { type: string; invoiceLineIndex: number; poLineId?: string; detail: string }
interface Line {
  description: string | null; kind: string | null; quantity: number; unit_price_minor: number; amount_minor: number | null;
}

async function load(id: string) {
  const [header] = (await db.execute(sql`
    SELECT i.number, i.status, i.exceptions, i.purchase_order_id, i.supplier_id, po.currency, s.name AS supplier
    FROM invoices i
    JOIN purchase_orders po ON po.id = i.purchase_order_id
    JOIN suppliers s ON s.id = i.supplier_id
    WHERE i.id = ${id}`)).rows as unknown as Header[];
  if (!header) return null;
  const lines = (await db.execute(sql`
    SELECT pl.description, pl.kind, il.quantity, il.unit_price_minor, il.amount_minor
    FROM invoice_lines il LEFT JOIN po_lines pl ON pl.id = il.po_line_id
    WHERE il.invoice_id = ${id} ORDER BY pl.description`)).rows as unknown as Line[];
  return { header, lines };
}

const lineTotal = (l: Line) => l.amount_minor ?? l.quantity * l.unit_price_minor;

export default async function InvoiceDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user || !isUuid(id)) notFound();
  const data = await load(id);
  if (!data) notFound();
  const { header, lines } = data;
  const money = (n: number) => formatMoney(n, header.currency);
  const finance = user.role === "FINANCE" || user.role === "ADMIN";
  const total = sumLinesMinor(lines.map((l) => ({ quantity: 1, unitPriceMinor: lineTotal(l) })));

  return (
    <div>
      <Link href="/invoices" className="text-sm text-gray-500 hover:underline">Invoices</Link>
      <div className="flex items-center justify-between my-4">
        <h1 className="text-xl font-bold">Invoice {header.number}</h1>
        <span data-testid="status"><StatusPill status={header.status} /></span>
      </div>
      <Card>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 p-5">
          <Fact label="Supplier"><Link href={`/suppliers/${header.supplier_id}`} className="text-[var(--brand)] hover:underline">{header.supplier}</Link></Fact>
          <Fact label="Purchase order"><Link href={`/purchase-orders/${header.purchase_order_id}`} className="text-[var(--brand)] hover:underline">{header.purchase_order_id.slice(0, 8)}</Link></Fact>
          <Fact label="Total">{money(total)}</Fact>
        </div>
      </Card>
      <Card title="Lines">
        <table className="w-full text-sm">
          <thead><tr className={TABLE_HEAD}>
            <th className="px-5 py-3">Description</th><th className="px-5 py-3">Qty</th>
            <th className="px-5 py-3">Unit price</th><th className="px-5 py-3">Line total</th>
          </tr></thead>
          <tbody>
            {lines.map((l, i) => (
              <tr key={i} className="border-t border-gray-50">
                <td className="px-5 py-3">{l.description ?? "Unmatched line"}</td>
                <td className="px-5 py-3">{l.quantity}</td>
                <td className="px-5 py-3">{money(l.unit_price_minor)}</td>
                <td className="px-5 py-3">{money(lineTotal(l))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      {header.exceptions.length > 0 && (
        <Card title="Match exceptions">
          <table className="w-full text-sm">
            <thead><tr className={TABLE_HEAD}>
              <th className="px-5 py-3">Type</th><th className="px-5 py-3">Invoice line</th>
              <th className="px-5 py-3">PO line</th><th className="px-5 py-3">Expected vs actual</th>
            </tr></thead>
            <tbody>
              {header.exceptions.map((x, i) => (
                <tr key={i} className="border-t border-gray-50">
                  <td className="px-5 py-3 font-medium">{x.type}</td>
                  <td className="px-5 py-3">{x.invoiceLineIndex + 1}</td>
                  <td className="px-5 py-3 font-mono text-xs">{x.poLineId ? x.poLineId.slice(0, 8) : "none"}</td>
                  <td className="px-5 py-3">{x.detail}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
      <InvoiceActions
        invoiceId={id}
        canMatch={header.status === "PENDING" || header.status === "EXCEPTION"}
        canApprove={header.status === "MATCHED" && finance}
      />
    </div>
  );
}
