import Link from "next/link";
import { notFound } from "next/navigation";
import { sql } from "drizzle-orm";
import { Card, Fact, StatusPill, TABLE_HEAD } from "@/components/ui";
import { RequisitionDetailActions } from "@/components/RequisitionDetailActions";
import { db } from "@/lib/db";
import { formatMoney } from "@/lib/format";
import { isUuid } from "@/lib/ids";
import { getCurrentUser } from "@/lib/session";
import { sumLinesMinor } from "@/lib/ui-text";

export const dynamic = "force-dynamic";

interface Header {
  status: string; currency: string; supplier: string; cost_center: string;
  requester: string; requester_id: string; created_at: string;
}
interface Line { description: string; kind: string; quantity: number; unit_price_minor: number }
interface ApprovalRow {
  id: string; approver_role: string; decision: string | null; comment: string | null;
  decided_at: string | null; decider: string | null;
}

async function load(id: string) {
  const [header] = (await db.execute(sql`
    SELECT r.status, r.currency, r.created_at, r.requester_id, s.name AS supplier,
           c.name AS cost_center, u.name AS requester
    FROM requisitions r
    JOIN suppliers s ON s.id = r.supplier_id
    JOIN cost_centers c ON c.id = r.cost_center_id
    JOIN users u ON u.id = r.requester_id
    WHERE r.id = ${id}`)).rows as unknown as Header[];
  if (!header) return null;
  const lines = (await db.execute(sql`
    SELECT description, kind, quantity, unit_price_minor FROM requisition_lines
    WHERE requisition_id = ${id} ORDER BY description`)).rows as unknown as Line[];
  const approvals = (await db.execute(sql`
    SELECT a.id, a.approver_role, a.decision, a.comment, a.decided_at, u.name AS decider
    FROM approvals a LEFT JOIN users u ON u.id = a.decided_by_user_id
    WHERE a.requisition_id = ${id} ORDER BY a.sequence`)).rows as unknown as ApprovalRow[];
  const [po] = (await db.execute(sql`
    SELECT id FROM purchase_orders WHERE requisition_id = ${id} AND status <> 'CANCELLED' LIMIT 1`)).rows as { id: string }[];
  return { header, lines, approvals, poId: po?.id ?? null };
}

export default async function RequisitionDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user || !isUuid(id)) notFound();
  const data = await load(id);
  if (!data) notFound();
  const { header, lines, approvals, poId } = data;
  const total = sumLinesMinor(lines.map((l) => ({ quantity: l.quantity, unitPriceMinor: l.unit_price_minor })));
  const pending = approvals.find((a) => a.decision === null && (a.approver_role === user.role || user.role === "ADMIN"));

  return (
    <div>
      <Link href="/requisitions" className="text-sm text-gray-500 hover:underline">Requisitions</Link>
      <div className="flex items-center justify-between my-4">
        <h1 className="text-xl font-bold">Requisition {id.slice(0, 8)}</h1>
        <span data-testid="status"><StatusPill status={header.status} /></span>
      </div>
      <Card>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 p-5">
          <Fact label="Supplier">{header.supplier}</Fact>
          <Fact label="Cost center">{header.cost_center}</Fact>
          <Fact label="Requester">{header.requester}</Fact>
          <Fact label="Total">{formatMoney(total, header.currency)}</Fact>
        </div>
      </Card>
      <Card title="Lines">
        <table className="w-full text-sm">
          <thead><tr className={TABLE_HEAD}>
            <th className="px-5 py-3">Kind</th><th className="px-5 py-3">Description</th>
            <th className="px-5 py-3">Qty</th><th className="px-5 py-3">Unit price</th><th className="px-5 py-3">Line total</th>
          </tr></thead>
          <tbody>
            {lines.map((l, i) => (
              <tr key={i} className="border-t border-gray-50">
                <td className="px-5 py-3">{l.kind}</td>
                <td className="px-5 py-3">{l.description}</td>
                <td className="px-5 py-3">{l.quantity}</td>
                <td className="px-5 py-3">{formatMoney(l.unit_price_minor, header.currency)}</td>
                <td className="px-5 py-3">{formatMoney(l.quantity * l.unit_price_minor, header.currency)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      <Card title="Approval history">
        <ul className="divide-y divide-gray-50 text-sm">
          {approvals.map((a) => (
            <li key={a.id} className="px-5 py-3 flex justify-between">
              <span>{a.approver_role}{a.decider ? `: ${a.decider}` : ""}{a.comment ? ` (${a.comment})` : ""}</span>
              <span className="text-gray-500">
                {a.decision ?? "pending"}
                {a.decided_at ? `, ${new Date(a.decided_at).toLocaleDateString("en-GB")}` : ""}
              </span>
            </li>
          ))}
          {approvals.length === 0 && <li className="px-5 py-3 text-gray-400">Not submitted yet</li>}
        </ul>
      </Card>
      <RequisitionDetailActions
        requisitionId={id}
        canSubmit={header.status === "DRAFT" && (user.id === header.requester_id || user.role === "ADMIN")}
        pendingApprovalId={pending?.id ?? null}
        canOrder={header.status === "APPROVED" && ["MANAGER", "FINANCE", "ADMIN"].includes(user.role)}
        poId={poId}
      />
    </div>
  );
}
