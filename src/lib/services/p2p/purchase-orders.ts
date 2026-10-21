import { and, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  budgetReservations,
  budgets,
  costCenters,
  integrationEvents,
  poLines,
  purchaseOrders,
  requisitionLines,
  requisitions,
  suppliers,
} from "@/lib/db/schema";
import { Money } from "@/domain/money";
import { guard as budgetGuard } from "@/domain/budget";
import { audit, DomainError, pgError, pgErrorCode, type Tx } from "./shared";

type RequisitionRow = typeof requisitions.$inferSelect;
type RequisitionLineRow = typeof requisitionLines.$inferSelect;

async function assertBudgetAvailable(tx: Tx, req: RequisitionRow, total: number, yearMonth: string) {
  const [cc] = await tx.select().from(costCenters).where(eq(costCenters.id, req.costCenterId));
  if (!cc) throw new DomainError("NOT_FOUND", "Cost center not found");

  const budgetRow = await loadBudgetStateWithin(tx, req.costCenterId, yearMonth);
  if (!budgetRow) throw new DomainError("INVALID_STATE", `No budget set for ${yearMonth}`);
  const result = budgetGuard(budgetRow.state, req.costCenterId, yearMonth, Money.of(total, req.currency));
  if (result.status === "exceeded") {
    throw new DomainError(
      "BUDGET_EXCEEDED",
      `Budget exceeded: available ${result.availableMinor}`,
      { availableMinor: result.availableMinor },
    );
  }
  return budgetRow;
}

async function persistPurchaseOrder(
  tx: Tx,
  req: RequisitionRow,
  lines: RequisitionLineRow[],
  budgetId: string,
  total: number,
  actorUserId: string,
) {
  const po = await insertPurchaseOrder(tx, req.id, req);
  await tx.insert(poLines).values(
    lines.map((l) => ({
      purchaseOrderId: po.id,
      description: l.description,
      quantityOrdered: l.quantity,
      unitPriceMinor: l.unitPriceMinor,
      kind: l.kind,
    })),
  );
  await tx.insert(budgetReservations).values({ budgetId, purchaseOrderId: po.id, amountMinor: total });
  await tx.update(requisitions).set({ status: "ORDERED" }).where(eq(requisitions.id, req.id));
  await audit(tx, "purchase_order", po.id, "CREATED", actorUserId, { total });
  return po;
}

async function emitPoCreated(
  tx: Tx,
  poId: string,
  req: RequisitionRow,
  lines: RequisitionLineRow[],
  total: number,
) {
  const [supplierRow] = await tx.select().from(suppliers).where(eq(suppliers.id, req.supplierId));
  const [ccName] = await tx.select({ name: costCenters.name }).from(costCenters).where(eq(costCenters.id, req.costCenterId));
  await tx.insert(integrationEvents).values({
    eventType: "PO_CREATED",
    payload: {
      purchaseOrderId: poId,
      supplier: supplierRow?.name ?? "",
      costCenter: ccName?.name ?? "",
      currency: req.currency,
      issuedOn: new Date().toISOString().slice(0, 10),
      totalMinor: total,
      lines: lines.map((l) => ({
        description: l.description,
        quantity: l.quantity,
        unitPriceMinor: l.unitPriceMinor,
      })),
    },
  });
}

export async function createPurchaseOrder(requisitionId: string, actorUserId: string) {
  return db.transaction(async (tx) => {
    const req = await lockApprovedRequisition(tx, requisitionId);

    const lines = await tx
      .select()
      .from(requisitionLines)
      .where(eq(requisitionLines.requisitionId, requisitionId));
    const total = lines.reduce((s, l) => s + l.quantity * l.unitPriceMinor, 0);

    const yearMonth = new Date().toISOString().slice(0, 7);
    const budgetRow = await assertBudgetAvailable(tx, req, total, yearMonth);
    const po = await persistPurchaseOrder(tx, req, lines, budgetRow.budget.id, total, actorUserId);
    await emitPoCreated(tx, po.id, req, lines, total);

    return { purchaseOrderId: po.id, totalMinor: total };
  });
}

async function insertPurchaseOrder(
  tx: Tx,
  requisitionId: string,
  req: { supplierId: string; costCenterId: string; currency: string },
) {
  try {
    const [po] = await tx
      .insert(purchaseOrders)
      .values({
        requisitionId,
        supplierId: req.supplierId,
        costCenterId: req.costCenterId,
        currency: req.currency,
      })
      .returning();
    return po;
  } catch (error) {
    if (pgErrorCode(error) === "23505" && pgError(error).constraint === "purchase_order_requisition_uq") {
      throw new DomainError("INVALID_STATE", "Requisition already ordered");
    }
    throw error;
  }
}

async function lockApprovedRequisition(tx: Tx, requisitionId: string) {
  // Row lock serializes concurrent orders; the loser sees ORDERED after the winner commits.
  const [req] = await tx
    .select()
    .from(requisitions)
    .where(eq(requisitions.id, requisitionId))
    .for("update");
  if (!req) throw new DomainError("NOT_FOUND", "Requisition not found");
  if (req.status !== "APPROVED") {
    throw new DomainError("INVALID_STATE", `Cannot order from ${req.status}`);
  }
  return req;
}

async function loadBudgetStateWithin(tx: Tx, costCenterId: string, yearMonth: string) {
  const [budget] = await tx
    .select()
    .from(budgets)
    .where(and(eq(budgets.costCenterId, costCenterId), eq(budgets.yearMonth, yearMonth)));
  if (!budget) return null;
  // Serialize concurrent PO creation against the same budget (TOCTOU guard).
  await tx.execute(sql`SELECT id FROM budgets WHERE id = ${budget.id} FOR UPDATE`);
  const reservations = await tx
    .select()
    .from(budgetReservations)
    .where(eq(budgetReservations.budgetId, budget.id));
  const state = { entries: new Map([[`${costCenterId}::${yearMonth}`, {
    budgetedMinor: budget.budgetedMinor,
    currency: budget.currency,
    reservations: new Map(reservations.map((r) => [r.id, r.amountMinor])),
  }]]) };
  return { budget, state };
}

export async function cancelPurchaseOrder(purchaseOrderId: string, actorUserId: string) {
  return db.transaction(async (tx) => {
    const [po] = await tx
      .select()
      .from(purchaseOrders)
      .where(eq(purchaseOrders.id, purchaseOrderId))
      .for("update");
    if (!po) throw new DomainError("NOT_FOUND", "PO not found");
    if (po.status !== "OPEN") {
      throw new DomainError("INVALID_STATE", `Cannot cancel from ${po.status}`);
    }
    await tx
      .update(purchaseOrders)
      .set({ status: "CANCELLED" })
      .where(eq(purchaseOrders.id, purchaseOrderId));

    if (po.requisitionId) {
      await tx
        .update(requisitions)
        .set({ status: "APPROVED" })
        .where(eq(requisitions.id, po.requisitionId));
    }

    await tx
      .delete(budgetReservations)
      .where(eq(budgetReservations.purchaseOrderId, purchaseOrderId));

    await audit(tx, "purchase_order", purchaseOrderId, "CANCELLED", actorUserId);
    return { status: "CANCELLED" as const };
  });
}
