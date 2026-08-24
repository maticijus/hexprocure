import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  approvalRules,
  approvals,
  budgetReservations,
  budgets,
  costCenters,
  invoiceLines,
  invoices,
  poLines,
  purchaseOrders,
  receiptLines,
  receipts,
  requisitionLines,
  requisitions,
  suppliers,
  users,
  auditEvents,
  integrationEvents,
} from "@/lib/db/schema";
import { Money } from "@/domain/money";
import { resolveApprovalChain } from "@/domain/approval";
import { guard as budgetGuard } from "@/domain/budget";
import { matchInvoice, type MatchException } from "@/domain/matching";

export class DomainError extends Error {
  constructor(
    readonly code:
      | "NOT_FOUND"
      | "INVALID_STATE"
      | "BUDGET_EXCEEDED"
      | "FORBIDDEN"
    | "VALIDATION",
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

export type DbOrTx = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

async function audit(
  tx: DbOrTx,
  entityType: string,
  entityId: string,
  action: string,
  actorUserId?: string | null,
  payload?: Record<string, unknown>,
) {
  await tx.insert(auditEvents).values({
    entityType,
    entityId,
    action,
    actorUserId: actorUserId ?? null,
    payload,
  });
}

export async function submitRequisition(requisitionId: string, actorUserId: string) {
  return db.transaction(async (tx) => {
    const [req] = await tx
      .select()
      .from(requisitions)
      .where(eq(requisitions.id, requisitionId));
    if (!req) throw new DomainError("NOT_FOUND", "Requisition not found");
    if (req.status !== "DRAFT") {
      throw new DomainError("INVALID_STATE", `Cannot submit from ${req.status}`);
    }

    const lines = await tx
      .select()
      .from(requisitionLines)
      .where(eq(requisitionLines.requisitionId, requisitionId));
    if (lines.length === 0) {
      throw new DomainError("INVALID_STATE", "Requisition has no lines");
    }
    const total = lines.reduce((s, l) => s + l.quantity * l.unitPriceMinor, 0);

    const rules = await tx
      .select()
      .from(approvalRules)
      .where(eq(approvalRules.currency, req.currency))
      .orderBy(asc(approvalRules.sequence));
    if (rules.length === 0) {
      throw new DomainError("INVALID_STATE", "No approval rules configured");
    }

    const chain = resolveApprovalChain(Money.of(total, req.currency), rules.map((r) => ({
      id: r.id,
      minAmount: Money.of(r.minMinor, r.currency),
      maxAmount: r.maxMinor === null ? undefined : Money.of(r.maxMinor, r.currency),
      approverRole: r.approverRole,
    })));

    await tx.insert(approvals).values(
      chain.map((step, i) => ({
        requisitionId,
        ruleId: step.ruleId,
        approverRole: step.approverRole,
        sequence: i,
      })),
    );
    await tx
      .update(requisitions)
      .set({ status: "SUBMITTED" })
      .where(eq(requisitions.id, requisitionId));
    await audit(tx, "requisition", requisitionId, "SUBMITTED", actorUserId, { total });

    const [supplierRow] = await tx.select().from(suppliers).where(eq(suppliers.id, req.supplierId));
    const roleUsers = await tx.select({ email: users.email, role: users.role }).from(users);
    for (const step of chain) {
      const recipients = roleUsers.filter((u) => u.role === step.approverRole).map((u) => u.email);
      if (recipients.length === 0) continue;
      await tx.insert(integrationEvents).values({
        eventType: "APPROVAL_REQUESTED",
        payload: {
          to: recipients,
          requisitionId,
          supplier: supplierRow?.name ?? "",
          totalMinor: total,
          currency: req.currency,
        },
      });
    }

    return { status: "SUBMITTED" as const, totalMinor: total, steps: chain.length };
  });
}

export async function decideApproval(
  approvalId: string,
  actorUserId: string,
  decision: "approve" | "reject",
  comment?: string,
) {
  return db.transaction(async (tx) => {
    const [actor] = await tx.select().from(users).where(eq(users.id, actorUserId));
    if (!actor) throw new DomainError("NOT_FOUND", "Actor not found");

    const [approval] = await tx.select().from(approvals).where(eq(approvals.id, approvalId));
    if (!approval) throw new DomainError("NOT_FOUND", "Approval not found");

    const isAuthorized =
      actor.role === approval.approverRole || actor.role === "ADMIN";
    if (!isAuthorized) {
      throw new DomainError("FORBIDDEN", `Requires ${approval.approverRole} role`);
    }
    if (approval.decision) {
      throw new DomainError("INVALID_STATE", "Approval already decided");
    }
    async function notifyRequester(tx2: Tx, outcome: "APPROVED" | "REJECTED") {
      const [req] = await tx2.select().from(requisitions).where(eq(requisitions.id, approval.requisitionId));
      if (!req) return;
      const [requester] = await tx2.select().from(users).where(eq(users.id, req.requesterId));
      if (!requester) return;
      await tx2.insert(integrationEvents).values({
        eventType: "REQUISITION_DECIDED",
        payload: { to: [requester.email], requisitionId: approval.requisitionId, decision: outcome },
      });
    }

    if (decision === "reject") {
      await tx.update(approvals).set({ decision: "REJECT", decidedByUserId: actorUserId, comment, decidedAt: new Date() }).where(eq(approvals.id, approvalId));
      await tx.update(requisitions).set({ status: "REJECTED" }).where(eq(requisitions.id, approval.requisitionId));
      await audit(tx, "requisition", approval.requisitionId, "REJECTED", actorUserId);
      await notifyRequester(tx, "REJECTED");
      return { requisitionStatus: "REJECTED" as const };
    }

    await tx.update(approvals).set({ decision: "APPROVE", decidedByUserId: actorUserId, comment, decidedAt: new Date() }).where(eq(approvals.id, approvalId));

    const remaining = await tx
      .select()
      .from(approvals)
      .where(and(eq(approvals.requisitionId, approval.requisitionId), eq(approvals.decision, "APPROVE")));
    const all = await tx
      .select()
      .from(approvals)
      .where(eq(approvals.requisitionId, approval.requisitionId));

    let requisitionStatus: "SUBMITTED" | "APPROVED" = "SUBMITTED";
    if (remaining.length === all.length) {
      await tx.update(requisitions).set({ status: "APPROVED" }).where(eq(requisitions.id, approval.requisitionId));
      requisitionStatus = "APPROVED";
      await audit(tx, "requisition", approval.requisitionId, "APPROVED", actorUserId);
      await notifyRequester(tx, "APPROVED");
    }
    return { requisitionStatus };
  });
}

export async function createPurchaseOrder(requisitionId: string, actorUserId: string) {
  return db.transaction(async (tx) => {
    const [req] = await tx.select().from(requisitions).where(eq(requisitions.id, requisitionId));
    if (!req) throw new DomainError("NOT_FOUND", "Requisition not found");
    if (req.status !== "APPROVED") {
      throw new DomainError("INVALID_STATE", `Cannot order from ${req.status}`);
    }

    const lines = await tx
      .select()
      .from(requisitionLines)
      .where(eq(requisitionLines.requisitionId, requisitionId));
    const total = lines.reduce((s, l) => s + l.quantity * l.unitPriceMinor, 0);

    const yearMonth = new Date().toISOString().slice(0, 7);
    const [cc] = await tx.select().from(costCenters).where(eq(costCenters.id, req.costCenterId));
    if (!cc) throw new DomainError("NOT_FOUND", "Cost center not found");

    const budgetRow = await loadBudgetStateWithin(tx, req.costCenterId, yearMonth);
    const amount = Money.of(total, req.currency);
    if (budgetRow) {
      const result = budgetGuard(budgetRow.state, req.costCenterId, yearMonth, amount);
      if (result.status === "exceeded") {
        throw new DomainError(
          "BUDGET_EXCEEDED",
          `Budget exceeded: available ${result.availableMinor}`,
          { availableMinor: result.availableMinor },
        );
      }
    } else {
      throw new DomainError("INVALID_STATE", `No budget set for ${yearMonth}`);
    }

    const [po] = await tx
      .insert(purchaseOrders)
      .values({
        requisitionId,
        supplierId: req.supplierId,
        costCenterId: req.costCenterId,
        currency: req.currency,
      })
      .returning();

    await tx.insert(poLines).values(
      lines.map((l) => ({
        purchaseOrderId: po.id,
        description: l.description,
        quantityOrdered: l.quantity,
        unitPriceMinor: l.unitPriceMinor,
      })),
    );

    await tx.insert(budgetReservations).values({
      budgetId: budgetRow.budget.id,
      purchaseOrderId: po.id,
      amountMinor: total,
    });

    await audit(tx, "purchase_order", po.id, "CREATED", actorUserId, { total });

    const [supplierRow] = await tx.select().from(suppliers).where(eq(suppliers.id, req.supplierId));
    const [ccName] = await tx.select({ name: costCenters.name }).from(costCenters).where(eq(costCenters.id, req.costCenterId));
    await tx.insert(integrationEvents).values({
      eventType: "PO_CREATED",
      payload: {
        purchaseOrderId: po.id,
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

    return { purchaseOrderId: po.id, totalMinor: total };
  });
}

type TxCallback = Parameters<typeof db.transaction>[0];
type Tx = Parameters<TxCallback>[0];

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
    const [po] = await tx.select().from(purchaseOrders).where(eq(purchaseOrders.id, purchaseOrderId));
    if (!po) throw new DomainError("NOT_FOUND", "PO not found");
    if (po.status !== "OPEN") {
      throw new DomainError("INVALID_STATE", `Cannot cancel from ${po.status}`);
    }
    await tx
      .update(purchaseOrders)
      .set({ status: "CANCELLED" })
      .where(eq(purchaseOrders.id, purchaseOrderId));

    await tx
      .delete(budgetReservations)
      .where(eq(budgetReservations.purchaseOrderId, purchaseOrderId));

    await audit(tx, "purchase_order", purchaseOrderId, "CANCELLED", actorUserId);
    return { status: "CANCELLED" as const };
  });
}

export async function addReceipt(
  purchaseOrderId: string,
  lines: { poLineId: string; quantityReceived: number }[],
  actorUserId: string,
) {
  return db.transaction(async (tx) => {
    const [po] = await tx.select().from(purchaseOrders).where(eq(purchaseOrders.id, purchaseOrderId));
    if (!po) throw new DomainError("NOT_FOUND", "PO not found");
    if (po.status !== "OPEN") {
      throw new DomainError("INVALID_STATE", `Cannot receive against ${po.status} PO`);
    }

    const poLineRows = await tx
      .select()
      .from(poLines)
      .where(inArray(poLines.id, lines.map((l) => l.poLineId)));
    const orderedById = new Map(poLineRows.map((p) => [p.id, p]));

    for (const line of lines) {
      const poLine = orderedById.get(line.poLineId);
      if (!poLine || poLine.purchaseOrderId !== purchaseOrderId) {
        throw new DomainError("NOT_FOUND", `Unknown PO line ${line.poLineId}`);
      }
      const priorReceipts = await tx
        .select({ qty: receiptLines.quantityReceived })
        .from(receiptLines)
        .innerJoin(receipts, eq(receiptLines.receiptId, receipts.id))
        .where(eq(receiptLines.poLineId, line.poLineId));
      const already = priorReceipts.reduce((s, r) => s + r.qty, 0);
      if (already + line.quantityReceived > poLine.quantityOrdered) {
        throw new DomainError(
          "INVALID_STATE",
          `Cumulative receipt ${already + line.quantityReceived} exceeds ordered ${poLine.quantityOrdered}`,
        );
      }
    }

    const [receipt] = await tx
      .insert(receipts)
      .values({ purchaseOrderId, receivedByUserId: actorUserId })
      .returning();
    await tx.insert(receiptLines).values(
      lines.map((l) => ({
        receiptId: receipt.id,
        poLineId: l.poLineId,
        quantityReceived: l.quantityReceived,
      })),
    );

    const poLineIds = (await tx.select().from(poLines).where(eq(poLines.purchaseOrderId, purchaseOrderId))).map((p) => p.id);
    const allReceipts = await tx
      .select({ poLineId: receiptLines.poLineId, qty: receiptLines.quantityReceived })
      .from(receiptLines)
      .where(inArray(receiptLines.poLineId, poLineIds.length ? poLineIds : ["00000000-0000-0000-0000-000000000000"]));
    const fullyReceived = poLineIds.length > 0 && poLineIds.every((id) => {
      const ordered = orderedById.get(id)?.quantityOrdered;
      const got = allReceipts.filter((r) => r.poLineId === id).reduce((s, r) => s + r.qty, 0);
      return ordered !== undefined && got >= ordered;
    });
    if (fullyReceived) {
      await tx.update(purchaseOrders).set({ status: "CLOSED" }).where(eq(purchaseOrders.id, purchaseOrderId));
      await audit(tx, "purchase_order", purchaseOrderId, "CLOSED", actorUserId);
    } else {
      await audit(tx, "receipt", receipt.id, "CREATED", actorUserId);
    }
    return { receiptId: receipt.id };
  });
}

export async function matchInvoiceById(invoiceId: string, actorUserId: string) {
  return db.transaction(async (tx) => {
    const [invoice] = await tx.select().from(invoices).where(eq(invoices.id, invoiceId));
    if (!invoice) throw new DomainError("NOT_FOUND", "Invoice not found");
    if (invoice.status === "APPROVED") {
      throw new DomainError("INVALID_STATE", "Approved invoice cannot be re-matched");
    }

    const invLines = await tx
      .select()
      .from(invoiceLines)
      .where(eq(invoiceLines.invoiceId, invoiceId));
    const referencedPoLineIds = invLines.map((l) => l.poLineId).filter((v): v is string => v !== null);
    const poLineRows = referencedPoLineIds.length
      ? await tx.select().from(poLines).where(inArray(poLines.id, referencedPoLineIds))
      : [];

    const receivedQtyByPoLine: Record<string, number> = {};
    if (poLineRows.length) {
      const recs = await tx
        .select({ poLineId: receiptLines.poLineId, qty: receiptLines.quantityReceived })
        .from(receiptLines)
        .where(inArray(receiptLines.poLineId, poLineRows.map((p) => p.id)));
      for (const r of recs) {
        receivedQtyByPoLine[r.poLineId] = (receivedQtyByPoLine[r.poLineId] ?? 0) + r.qty;
      }
    }

    const previouslyInvoicedQtyByPoLine: Record<string, number> = {};
    if (poLineRows.length) {
      const poId = invoice.purchaseOrderId;
      const priorInvLines = await tx
        .select({ poLineId: invoiceLines.poLineId, qty: invoiceLines.quantity, invoiceId: invoiceLines.invoiceId })
        .from(invoiceLines)
        .innerJoin(invoices, eq(invoiceLines.invoiceId, invoices.id))
        .where(and(inArray(invoiceLines.poLineId, poLineRows.map((p) => p.id)), eq(invoices.purchaseOrderId, poId)));
      for (const l of priorInvLines) {
        if (l.poLineId && l.invoiceId !== invoiceId) {
          previouslyInvoicedQtyByPoLine[l.poLineId] = (previouslyInvoicedQtyByPoLine[l.poLineId] ?? 0) + l.qty;
        }
      }
    }

    const result = matchInvoice(
      {
        poLines: poLineRows.map((p) => ({
          id: p.id,
          quantityOrdered: p.quantityOrdered,
          unitPriceMinor: p.unitPriceMinor,
        })),
        receivedQtyByPoLine,
        previouslyInvoicedQtyByPoLine,
      },
      invLines.map((l) => ({
        poLineId: l.poLineId,
        quantity: l.quantity,
        unitPriceMinor: l.unitPriceMinor,
      })),
    );

    const status = result.status === "MATCHED" ? "MATCHED" : "EXCEPTION";
    await tx
      .update(invoices)
      .set({ status, exceptions: result.exceptions })
      .where(eq(invoices.id, invoiceId));
    await audit(tx, "invoice", invoiceId, status, actorUserId, {
      exceptions: result.exceptions,
    });

    if (status === "EXCEPTION") {
      const financeUsers = await tx.select({ email: users.email }).from(users).where(eq(users.role, "FINANCE"));
      if (financeUsers.length > 0) {
        await tx.insert(integrationEvents).values({
          eventType: "INVOICE_EXCEPTION",
          payload: {
            to: financeUsers.map((f) => f.email),
            invoiceId,
            invoiceNumber: invoice.number,
            exceptions: result.exceptions,
          },
        });
      }
    }
    return { status, exceptions: result.exceptions as MatchException[] };
  });
}


export async function approveInvoice(invoiceId: string, actorUserId: string) {
  return db.transaction(async (tx) => {
    const [actor] = await tx.select().from(users).where(eq(users.id, actorUserId));
    if (!actor || (actor.role !== "FINANCE" && actor.role !== "ADMIN")) {
      throw new DomainError("FORBIDDEN", "Requires FINANCE or ADMIN role");
    }
    const [invoice] = await tx.select().from(invoices).where(eq(invoices.id, invoiceId));
    if (!invoice) throw new DomainError("NOT_FOUND", "Invoice not found");
    if (invoice.status !== "MATCHED") {
      throw new DomainError("INVALID_STATE", `Only MATCHED invoices can be approved (current: ${invoice.status})`);
    }
    await tx.update(invoices).set({ status: "APPROVED" }).where(eq(invoices.id, invoiceId));
    await audit(tx, "invoice", invoiceId, "APPROVED", actorUserId);

    const [invSupplier] = await tx.select().from(suppliers).where(eq(suppliers.id, invoice.supplierId));
    await tx.insert(integrationEvents).values({
      eventType: "INVOICE_APPROVED",
      payload: {
        invoiceId,
        invoiceNumber: invoice.number,
        supplier: invSupplier?.name ?? "",
        currency: "EUR",
        totalMinor: (
          await tx
            .select({ total: sql<number>`COALESCE(SUM(${invoiceLines.quantity} * ${invoiceLines.unitPriceMinor}), 0)` })
            .from(invoiceLines)
            .where(eq(invoiceLines.invoiceId, invoiceId))
        )[0].total,
        purchaseOrderId: invoice.purchaseOrderId,
      },
    });

    return { status: "APPROVED" as const };
  });
}

