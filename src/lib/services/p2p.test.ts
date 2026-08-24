import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { eq, sql } from "drizzle-orm";
import { db, pool } from "@/lib/db";
import {
  users,
  suppliers,
  costCenters,
  budgets,
  approvalRules,
  requisitions,
  requisitionLines,
  approvals,
  invoices,
  integrationEvents as integrationEventsTable,
} from "@/lib/db/schema";
import {
  submitRequisition,
  decideApproval,
  createPurchaseOrder,
  cancelPurchaseOrder,
  addReceipt,
  matchInvoiceById,
  approveInvoice,
  DomainError,
} from "@/lib/services/p2p";

async function seed() {
  const [requester] = await db
    .insert(users)
    .values({ name: "Requester Rita", email: `rita-${Date.now()}@hex.test` })
    .returning();
  const [manager] = await db
    .insert(users)
    .values({ name: "Manager Max", email: `max-${Date.now()}@hex.test`, role: "MANAGER" })
    .returning();
  const [finance] = await db
    .insert(users)
    .values({ name: "Finance Fiona", email: `fiona-${Date.now()}@hex.test`, role: "FINANCE" })
    .returning();
  const [supplier] = await db
    .insert(suppliers)
    .values({ name: "Acme GmbH" })
    .returning();
  const [cc] = await db.insert(costCenters).values({ name: "IT" }).returning();
  const yearMonth = new Date().toISOString().slice(0, 7);
  const [budget] = await db
    .insert(budgets)
    .values({ costCenterId: cc.id, yearMonth, budgetedMinor: 1_000_000, currency: "EUR" })
    .returning();
  const rules = await db
    .insert(approvalRules)
    .values([
      { sequence: 1, minMinor: 0, maxMinor: 50000, approverRole: "MANAGER", currency: "EUR" },
      { sequence: 2, minMinor: 50000, maxMinor: null, approverRole: "FINANCE", currency: "EUR" },
    ])
    .returning();
  return { requester, manager, finance, supplier, cc, yearMonth, budget, rules };
}

async function createRequisitionWithLine(
  requesterId: string,
  supplierId: string,
  costCenterId: string,
  qty: number,
  unitPriceMinor: number,
) {
  const [req] = await db
    .insert(requisitions)
    .values({ requesterId, supplierId, costCenterId, currency: "EUR" })
    .returning();
  await db.insert(requisitionLines).values({
    requisitionId: req.id,
    description: "Laptops",
    quantity: qty,
    unitPriceMinor,
  });
  return req;
}

beforeEach(async () => {
  for (const table of [
    "audit_events",
    "invoice_lines",
    "invoices",
    "receipt_lines",
    "receipts",
    "po_lines",
    "purchase_orders",
    "budget_reservations",
    "approvals",
    "requisition_lines",
    "requisitions",
    "approval_rules",
    "budgets",
    "cost_centers",
    "suppliers",
    "users",
  ]) {
    await db.execute(sql.raw(`TRUNCATE ${table} CASCADE`));
  }
});

describe("P2P happy path", () => {
  it("walks requisition → approval → PO → receipt → invoice MATCHED → APPROVED", async () => {
    const s = await seed();

    const req = await createRequisitionWithLine(
      s.requester.id,
      s.supplier.id,
      s.cc.id,
      10,
      1999,
    );

    const submitted = await submitRequisition(req.id, s.requester.id);
    expect(submitted.steps).toBe(1);
    expect(submitted.totalMinor).toBe(19990);

    const approvalRows = await db.select().from(approvals);
    expect(approvalRows[0].approverRole).toBe("MANAGER");

    const decided = await decideApproval(approvalRows[0].id, s.manager.id, "approve");
    expect(decided.requisitionStatus).toBe("APPROVED");

    const po = await createPurchaseOrder(req.id, s.manager.id);
    expect(po.totalMinor).toBe(19990);

    const [poLine] = (
      await db.execute(sql`SELECT id FROM po_lines WHERE purchase_order_id = ${po.purchaseOrderId}`)
    ).rows as { id: string }[];

    await addReceipt(po.purchaseOrderId, [{ poLineId: poLine.id, quantityReceived: 10 }], s.requester.id);

    const [invoice] = await db
      .insert(invoices)
      .values({
        supplierId: s.supplier.id,
        purchaseOrderId: po.purchaseOrderId,
        number: "INV-001",
        status: "PENDING",
      })
      .returning();
    const { invoiceLines } = await import("@/lib/db/schema");
    await db.insert(invoiceLines).values({
      invoiceId: invoice.id,
      poLineId: poLine.id,
      quantity: 10,
      unitPriceMinor: 1999,
    });

    const matched = await matchInvoiceById(invoice.id, s.finance.id);
    expect(matched.status).toBe("MATCHED");

    const approved = await approveInvoice(invoice.id, s.finance.id);
    expect(approved.status).toBe("APPROVED");
  });
});

describe("budget guard at PO time", () => {
  it("rejects PO creation exceeding remaining budget with BUDGET_EXCEEDED", async () => {
    const s = await seed();
    await db
      .update(budgets)
      .set({ budgetedMinor: 10000 })
      .where(eq(budgets.id, s.budget.id));

    const req = await createRequisitionWithLine(
      s.requester.id,
      s.supplier.id,
      s.cc.id,
      10,
      5000,
    );
    await submitRequisition(req.id, s.requester.id);
    const approvalsForReq = await db
      .select()
      .from(approvals)
      .where(eq(approvals.requisitionId, req.id));
    for (const a of approvalsForReq) {
      const decider = a.approverRole === "FINANCE" ? s.finance : s.manager;
      await decideApproval(a.id, decider.id, "approve");
    }

    await expect(createPurchaseOrder(req.id, s.manager.id)).rejects.toMatchObject({
      code: "BUDGET_EXCEEDED",
    });
  });
});

describe("authorization and state guards", () => {
  it("forbids a MANAGER deciding a FINANCE step", async () => {
    const s = await seed();
    const req = await createRequisitionWithLine(
      s.requester.id,
      s.supplier.id,
      s.cc.id,
      1000,
      1999,
    );
    await submitRequisition(req.id, s.requester.id);
    const [approval] = await db.select().from(approvals);
    expect(approval.approverRole).toBe("FINANCE");
    await expect(
      decideApproval(approval.id, s.manager.id, "approve"),
    ).rejects.toBeInstanceOf(DomainError);
  });

  it("refuses to approve an EXCEPTION invoice", async () => {
    const s = await seed();
    const req = await createRequisitionWithLine(
      s.requester.id,
      s.supplier.id,
      s.cc.id,
      10,
      1999,
    );
    await submitRequisition(req.id, s.requester.id);
    const [approval] = await db.select().from(approvals);
    await decideApproval(approval.id, s.manager.id, "approve");
    const poResult = await createPurchaseOrder(req.id, s.manager.id);

    const [invoice] = await db
      .insert(invoices)
      .values({
        supplierId: s.supplier.id,
        purchaseOrderId: poResult.purchaseOrderId,
        number: "INV-BAD",
      })
      .returning();
    const { invoiceLines } = await import("@/lib/db/schema");
    await db.insert(invoiceLines).values({
      invoiceId: invoice.id,
      poLineId: null,
      quantity: 5,
      unitPriceMinor: 99999,
    });

    const result = await matchInvoiceById(invoice.id, s.finance.id);
    expect(result.status).toBe("EXCEPTION");
    await expect(approveInvoice(invoice.id, s.finance.id)).rejects.toMatchObject({
      code: "INVALID_STATE",
    });
  });

  it("cancelling a PO releases its budget reservation", async () => {
    const s = await seed();
    await db.update(budgets).set({ budgetedMinor: 30000 }).where(eq(budgets.id, s.budget.id));
    const req = await createRequisitionWithLine(s.requester.id, s.supplier.id, s.cc.id, 10, 2500);
    await submitRequisition(req.id, s.requester.id);
    const [approval] = await db.select().from(approvals);
    await decideApproval(approval.id, s.manager.id, "approve");
    const po = await createPurchaseOrder(req.id, s.manager.id);

    const req2 = await createRequisitionWithLine(s.requester.id, s.supplier.id, s.cc.id, 3, 2500);
    await submitRequisition(req2.id, s.requester.id);
    const allApprovals = await db.select().from(approvals).orderBy(approvals.sequence);
    const second = allApprovals.find((a) => a.requisitionId === req2.id)!;
    await decideApproval(second.id, s.manager.id, "approve");
    await expect(createPurchaseOrder(req2.id, s.manager.id)).rejects.toMatchObject({
      code: "BUDGET_EXCEEDED",
    });

    await cancelPurchaseOrder(po.purchaseOrderId, s.manager.id);
    await expect(createPurchaseOrder(req2.id, s.manager.id)).resolves.toMatchObject({
      totalMinor: 7500,
    });
  });
});

afterAll(async () => {
  await pool.end();
});

describe("notification event emission", () => {
  it("enqueues APPROVAL_REQUESTED per step with approver-role recipients", async () => {
    const s = await seed();
    const req = await createRequisitionWithLine(s.requester.id, s.supplier.id, s.cc.id, 2, 1999);
    await submitRequisition(req.id, s.requester.id);

    const events = await db.select().from(integrationEventsTable);
    const requested = events.filter((e) => e.eventType === "APPROVAL_REQUESTED");
    expect(requested).toHaveLength(1);
    expect(requested[0].payload.to).toEqual([s.manager.email]);
  });

  it("enqueues REQUISITION_DECIDED to the requester on rejection", async () => {
    const s = await seed();
    const req = await createRequisitionWithLine(s.requester.id, s.supplier.id, s.cc.id, 1, 1000);
    await submitRequisition(req.id, s.requester.id);
    const [approval] = await db.select().from(approvals);

    await decideApproval(approval.id, s.manager.id, "reject");

    const decided = (await db.select().from(integrationEventsTable))
      .filter((e) => e.eventType === "REQUISITION_DECIDED");
    expect(decided).toHaveLength(1);
    expect(decided[0].payload.to).toEqual([s.requester.email]);
    expect(decided[0].payload.decision).toBe("REJECTED");
  });

  it("notifies FINANCE users when matching produces exceptions", async () => {
    const s = await seed();
    const req = await createRequisitionWithLine(s.requester.id, s.supplier.id, s.cc.id, 5, 2000);
    await submitRequisition(req.id, s.requester.id);
    const [approval] = await db.select().from(approvals);
    await decideApproval(approval.id, s.manager.id, "approve");
    const poResult = await createPurchaseOrder(req.id, s.manager.id);

    const [invoice] = await db
      .insert(invoices)
      .values({ supplierId: s.supplier.id, purchaseOrderId: poResult.purchaseOrderId, number: "INV-X" })
      .returning();
    const { invoiceLines } = await import("@/lib/db/schema");
    await db.insert(invoiceLines).values({
      invoiceId: invoice.id, poLineId: null, quantity: 9, unitPriceMinor: 1,
    });
    await matchInvoiceById(invoice.id, s.finance.id);

    const events = (await db.select().from(integrationEventsTable))
      .filter((e) => e.eventType === "INVOICE_EXCEPTION");
    expect(events).toHaveLength(1);
    expect(events[0].payload.to).toEqual([s.finance.email]);
    expect(events[0].payload.invoiceNumber).toBe("INV-X");
  });
});
