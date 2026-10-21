import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  integrationEvents,
  invoiceLines,
  invoices,
  poLines,
  purchaseOrders,
  receiptLines,
  suppliers,
  users,
} from "@/lib/db/schema";
import { matchInvoice, type MatchException } from "@/domain/matching";
import { audit, DomainError, pgErrorCode, type Tx } from "./shared";

export interface CreateInvoiceInput {
  supplierId: string;
  purchaseOrderId: string;
  number: string;
  lines: { poLineId?: string; quantity?: number; unitPriceMinor?: number; amountMinor?: number }[];
}

export async function createInvoice(input: CreateInvoiceInput, actorUserId: string) {
  if (!input.supplierId) throw new DomainError("VALIDATION", "supplierId is required");
  if (!input.purchaseOrderId) throw new DomainError("VALIDATION", "purchaseOrderId is required");
  const number = input.number?.trim();
  if (!number) throw new DomainError("VALIDATION", "number is required");
  if (!Array.isArray(input.lines) || input.lines.length === 0) {
    throw new DomainError("VALIDATION", "at least one invoice line is required");
  }
  for (const [i, line] of input.lines.entries()) {
    if (typeof line.quantity !== "number" || !Number.isInteger(line.quantity) || line.quantity <= 0) {
      throw new DomainError("VALIDATION", `line ${i}: quantity must be a positive integer`);
    }
    if (
      typeof line.unitPriceMinor !== "number" ||
      !Number.isInteger(line.unitPriceMinor) ||
      line.unitPriceMinor < 0
    ) {
      throw new DomainError("VALIDATION", `line ${i}: unitPriceMinor must be a non-negative integer`);
    }
    if (line.amountMinor !== undefined && (!Number.isInteger(line.amountMinor) || line.amountMinor < 0)) {
      throw new DomainError("VALIDATION", `line ${i}: amountMinor must be a non-negative integer`);
    }
  }

  return db.transaction(async (tx) => {
    const [po] = await tx.select().from(purchaseOrders).where(eq(purchaseOrders.id, input.purchaseOrderId));
    if (!po) throw new DomainError("NOT_FOUND", "PO not found");
    if (po.supplierId !== input.supplierId) {
      throw new DomainError("VALIDATION", "supplierId does not match the PO supplier");
    }

    const referencedPoLineIds = input.lines
      .map((l) => l.poLineId)
      .filter((id): id is string => typeof id === "string");
    const poLineRows = referencedPoLineIds.length
      ? await tx
          .select()
          .from(poLines)
          .where(and(inArray(poLines.id, referencedPoLineIds), eq(poLines.purchaseOrderId, po.id)))
      : [];
    const poLineById = new Map(poLineRows.map((p) => [p.id, p]));
    for (const [i, line] of input.lines.entries()) {
      if (line.poLineId && !poLineById.has(line.poLineId)) {
        throw new DomainError("VALIDATION", `line ${i}: poLineId does not belong to this PO`);
      }
    }

    try {
      const [invoice] = await tx
        .insert(invoices)
        .values({
          supplierId: po.supplierId,
          purchaseOrderId: po.id,
          number,
          status: "PENDING",
        })
        .returning();
      await tx.insert(invoiceLines).values(
        input.lines.map((l) => ({
          invoiceId: invoice.id,
          poLineId: l.poLineId ?? null,
          quantity: l.quantity!,
          unitPriceMinor: l.unitPriceMinor!,
          amountMinor: l.amountMinor ?? null,
        })),
      );
      await audit(tx, "invoice", invoice.id, "CREATED", actorUserId, { number });
      return invoice;
    } catch (error) {
      if (pgErrorCode(error) === "23505") {
        throw new DomainError("INVALID_STATE", "Invoice number already exists for this supplier");
      }
      throw error;
    }
  });
}

// PENDING and EXCEPTION invoices are not yet committed spend.
const COMMITTED_INVOICE_STATUSES: ("MATCHED" | "APPROVED")[] = ["MATCHED", "APPROVED"];

// addReceipt records service acceptance as a receipt line, so any receipt accepts the whole line.
async function loadAcceptedServiceAmounts(
  tx: Tx,
  poLineRows: { id: string; kind: string; quantityOrdered: number; unitPriceMinor: number }[],
): Promise<Record<string, number>> {
  const services = poLineRows.filter((p) => p.kind === "SERVICE");
  if (services.length === 0) return {};
  const accepted = await tx
    .select({ poLineId: receiptLines.poLineId })
    .from(receiptLines)
    .where(inArray(receiptLines.poLineId, services.map((p) => p.id)));
  const acceptedIds = new Set(accepted.map((r) => r.poLineId));
  return Object.fromEntries(
    services
      .filter((p) => acceptedIds.has(p.id))
      .map((p) => [p.id, p.quantityOrdered * p.unitPriceMinor]),
  );
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
      ? await tx
          .select()
          .from(poLines)
          .where(
            and(
              inArray(poLines.id, referencedPoLineIds),
              eq(poLines.purchaseOrderId, invoice.purchaseOrderId),
            ),
          )
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

    const acceptedAmountByPoLine = await loadAcceptedServiceAmounts(tx, poLineRows);

    const previouslyInvoicedQtyByPoLine: Record<string, number> = {};
    if (poLineRows.length) {
      const poId = invoice.purchaseOrderId;
      const priorInvLines = await tx
        .select({ poLineId: invoiceLines.poLineId, qty: invoiceLines.quantity, invoiceId: invoiceLines.invoiceId })
        .from(invoiceLines)
        .innerJoin(invoices, eq(invoiceLines.invoiceId, invoices.id))
        .where(and(inArray(invoiceLines.poLineId, poLineRows.map((p) => p.id)), eq(invoices.purchaseOrderId, poId), inArray(invoices.status, COMMITTED_INVOICE_STATUSES)));
      for (const l of priorInvLines) {
        if (l.poLineId && l.invoiceId !== invoiceId) {
          previouslyInvoicedQtyByPoLine[l.poLineId] = (previouslyInvoicedQtyByPoLine[l.poLineId] ?? 0) + l.qty;
        }
      }
    }

    const previouslyInvoicedAmountByPoLine: Record<string, number> = {};
    const serviceIds = new Set(poLineRows.filter((p) => p.kind === "SERVICE").map((p) => p.id));
    if (serviceIds.size > 0) {
      const priorAmountRows = await tx
        .select({
          poLineId: invoiceLines.poLineId,
          invoiceId: invoiceLines.invoiceId,
          amountMinor: invoiceLines.amountMinor,
          qty: invoiceLines.quantity,
          unit: invoiceLines.unitPriceMinor,
        })
        .from(invoiceLines)
        .innerJoin(invoices, eq(invoiceLines.invoiceId, invoices.id))
        .where(
          and(
            inArray(invoiceLines.poLineId, [...serviceIds]),
            eq(invoices.purchaseOrderId, invoice.purchaseOrderId),
            inArray(invoices.status, COMMITTED_INVOICE_STATUSES),
          ),
        );
      for (const row of priorAmountRows) {
        if (!row.poLineId || row.invoiceId === invoiceId) continue;
        const amount = row.amountMinor ?? row.qty * row.unit;
        previouslyInvoicedAmountByPoLine[row.poLineId] =
          (previouslyInvoicedAmountByPoLine[row.poLineId] ?? 0) + amount;
      }
    }

    const result = matchInvoice(
      {
        poLines: poLineRows.map((p) => ({
          id: p.id,
          quantityOrdered: p.quantityOrdered,
          unitPriceMinor: p.unitPriceMinor,
          kind: p.kind,
        })),
        receivedQtyByPoLine,
        previouslyInvoicedQtyByPoLine,
        previouslyInvoicedAmountByPoLine,
        acceptedAmountByPoLine,
      },
      invLines.map((l) => ({
        poLineId: l.poLineId,
        quantity: l.quantity,
        unitPriceMinor: l.unitPriceMinor,
        amountMinor: l.amountMinor ?? undefined,
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
    // Conditional update is the lock: a concurrent approver matches zero rows.
    const claimed = await tx
      .update(invoices)
      .set({ status: "APPROVED" })
      .where(and(eq(invoices.id, invoiceId), eq(invoices.status, "MATCHED")))
      .returning({ id: invoices.id });
    if (claimed.length === 0) {
      throw new DomainError("INVALID_STATE", "Only MATCHED invoices can be approved");
    }
    await audit(tx, "invoice", invoiceId, "APPROVED", actorUserId);

    const [invSupplier] = await tx.select().from(suppliers).where(eq(suppliers.id, invoice.supplierId));
    const [po] = await tx
      .select({ currency: purchaseOrders.currency })
      .from(purchaseOrders)
      .where(eq(purchaseOrders.id, invoice.purchaseOrderId));
    await tx.insert(integrationEvents).values({
      eventType: "INVOICE_APPROVED",
      payload: {
        invoiceId,
        invoiceNumber: invoice.number,
        supplier: invSupplier?.name ?? "",
        currency: po.currency,
        totalMinor: await invoiceTotalMinor(tx, invoiceId),
        purchaseOrderId: invoice.purchaseOrderId,
      },
    });

    return { status: "APPROVED" as const };
  });
}

async function invoiceTotalMinor(tx: Tx, invoiceId: string) {
  // amount_minor is only checked by matching on SERVICE lines, so goods bill at quantity * unit price.
  const [{ total }] = await tx
    .select({
      total: sql<string>`COALESCE(SUM(CASE WHEN ${poLines.kind} = 'SERVICE'
        THEN COALESCE(${invoiceLines.amountMinor}::bigint, ${invoiceLines.quantity}::bigint * ${invoiceLines.unitPriceMinor})
        ELSE ${invoiceLines.quantity}::bigint * ${invoiceLines.unitPriceMinor} END), 0)::bigint`,
    })
    .from(invoiceLines)
    .leftJoin(poLines, eq(invoiceLines.poLineId, poLines.id))
    .where(eq(invoiceLines.invoiceId, invoiceId));
  const totalMinor = Number(total);
  if (!Number.isSafeInteger(totalMinor)) {
    throw new DomainError("INVALID_STATE", `Invoice total ${total} exceeds safe integer range`);
  }
  return totalMinor;
}
