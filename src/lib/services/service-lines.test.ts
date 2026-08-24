import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { eq, sql } from "drizzle-orm";
import { db, pool } from "@/lib/db";
import {
  approvals,
  invoices,
  purchaseOrders,
  requisitionLines,
  requisitions,
} from "@/lib/db/schema";
import { seedOrg, truncateAll } from "@/lib/testing/seed";
import {
  submitRequisition,
  decideApproval,
  createPurchaseOrder,
  addReceipt,
  matchInvoiceById,
} from "./p2p";

beforeEach(async () => {
  await truncateAll();
});

async function seededServicePo(opts?: { mixed?: boolean }) {
  const s = await seedOrg();
  const [req] = await db
    .insert(requisitions)
    .values({ requesterId: s.requester.id, supplierId: s.supplier.id, costCenterId: s.cc.id })
    .returning();
  await db.insert(requisitionLines).values([
    { requisitionId: req.id, description: "Consulting — Phase 1", quantity: 1, unitPriceMinor: 500_000, kind: "SERVICE" },
    ...(opts?.mixed
      ? [{ requisitionId: req.id, description: "Cables", quantity: 10, unitPriceMinor: 500 }]
      : []),
  ]);
  await submitRequisition(req.id, s.requester.id);
  for (const a of await db.select().from(approvals)) {
    const decider = a.approverRole === "FINANCE" ? s.finance : a.approverRole === "MANAGER" ? s.manager : s.finance;
    await decideApproval(a.id, decider.id, "approve");
  }
  const po = await createPurchaseOrder(req.id, s.requester.id);
  const lines = (await db.execute(sql`SELECT id, kind FROM po_lines WHERE purchase_order_id = ${po.purchaseOrderId} ORDER BY description`)).rows as { id: string; kind: string }[];
  return { s, req, poId: po.purchaseOrderId, lines };
}


describe("service line acceptance", () => {
  it("accepts a SERVICE line via accepted:true without quantities and closes the PO", async () => {
    const { s, poId, lines } = await seededServicePo();
    const svc = lines.find((l) => l.kind === "SERVICE")!;

    const result = await addReceipt(poId, [{ poLineId: svc.id, quantityReceived: 0, accepted: true }], s.requester.id);
    expect(result.receiptId).toBeTruthy();

    const [po] = await db.select().from(purchaseOrders).where(eq(purchaseOrders.id, poId));
    expect(po.status).toBe("CLOSED");
  });

  it("requires accepted:true on service lines", async () => {
    const { s, poId, lines } = await seededServicePo();
    const svc = lines.find((l) => l.kind === "SERVICE")!;
    await expect(
      addReceipt(poId, [{ poLineId: svc.id, quantityReceived: 1 }], s.requester.id),
    ).rejects.toMatchObject({ code: "INVALID_STATE" });
  });

  it("mixed PO closes only when goods are fully received AND services accepted", async () => {
    const { s, poId, lines } = await seededServicePo({ mixed: true });
    const svc = lines.find((l) => l.kind === "SERVICE")!;
    const goods = lines.find((l) => l.kind === "GOODS")!;

    // accept service only -> still OPEN
    await addReceipt(poId, [{ poLineId: svc.id, quantityReceived: 0, accepted: true }], s.requester.id);
    let [po] = await db.select().from(purchaseOrders).where(eq(purchaseOrders.id, poId));
    expect(po.status).toBe("OPEN");

    // receive all goods -> now closes
    await addReceipt(poId, [{ poLineId: goods.id, quantityReceived: 10 }], s.requester.id);
    [po] = await db.select().from(purchaseOrders).where(eq(purchaseOrders.id, poId));
    expect(po.status).toBe("CLOSED");
  });
});

describe("service invoice matching end-to-end", () => {
  it("MATCHES an amount-fitting invoice with zero receipts; flags OVER_INVOICED_AMOUNT beyond ordered", async () => {
    const { s, poId, lines } = await seededServicePo();
    const svc = lines.find((l) => l.kind === "SERVICE")!;

    const mkInvoice = async (number: string, amountMinor: number) => {
      const [inv] = await db
        .insert(invoices)
        .values({ supplierId: s.supplier.id, purchaseOrderId: poId, number })
        .returning();
      const { invoiceLines } = await import("@/lib/db/schema");
      await db.insert(invoiceLines).values({
        invoiceId: inv.id, poLineId: svc.id, quantity: 1, unitPriceMinor: 0, amountMinor,
      });
      return inv.id;
    };

    const first = await matchInvoiceById(await mkInvoice("SVC-1", 400_000), s.finance.id);
    expect(first.status).toBe("MATCHED");

    const second = await matchInvoiceById(await mkInvoice("SVC-2", 200_000), s.finance.id);
    expect(second.status).toBe("EXCEPTION");
    expect(second.exceptions[0].type).toBe("OVER_INVOICED_AMOUNT");
  });
});

afterAll(async () => {
  await pool.end();
});
