import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { poLines, purchaseOrders, receiptLines, receipts } from "@/lib/db/schema";
import { audit, DomainError, type Tx } from "./shared";

type ReceiptLineInput = { poLineId: string; quantityReceived: number; accepted?: boolean };

function mergeReceiptLines(lines: ReceiptLineInput[]): ReceiptLineInput[] {
  const merged = new Map<string, ReceiptLineInput>();
  for (const line of lines) {
    const prev = merged.get(line.poLineId);
    merged.set(
      line.poLineId,
      prev
        ? {
            poLineId: line.poLineId,
            quantityReceived: prev.quantityReceived + line.quantityReceived,
            accepted: Boolean(prev.accepted) && Boolean(line.accepted),
          }
        : line,
    );
  }
  return [...merged.values()];
}

async function assertReceivable(tx: Tx, purchaseOrderId: string, lines: ReceiptLineInput[]) {
  const poLineRows = await tx
    .select()
    .from(poLines)
    .where(eq(poLines.purchaseOrderId, purchaseOrderId));
  const poLineById = new Map(poLineRows.map((p) => [p.id, p]));
  const prior = await tx
    .select({ poLineId: receiptLines.poLineId, qty: receiptLines.quantityReceived })
    .from(receiptLines)
    .innerJoin(receipts, eq(receiptLines.receiptId, receipts.id))
    .where(eq(receipts.purchaseOrderId, purchaseOrderId));

  for (const line of lines) {
    const poLine = poLineById.get(line.poLineId);
    if (!poLine) throw new DomainError("NOT_FOUND", `Unknown PO line ${line.poLineId}`);
    if (poLine.kind === "SERVICE") {
      if (!line.accepted) {
        throw new DomainError("INVALID_STATE", `Service line ${line.poLineId} requires accepted:true`);
      }
      continue;
    }
    const already = prior.filter((r) => r.poLineId === line.poLineId).reduce((sum, r) => sum + r.qty, 0);
    if (already + line.quantityReceived > poLine.quantityOrdered) {
      throw new DomainError(
        "INVALID_STATE",
        `Cumulative receipt ${already + line.quantityReceived} exceeds ordered ${poLine.quantityOrdered}`,
      );
    }
  }
}

async function closeIfFullyReceived(tx: Tx, purchaseOrderId: string, receiptId: string, actorUserId: string) {
  const allPoLines = await tx.select().from(poLines).where(eq(poLines.purchaseOrderId, purchaseOrderId));
  const allReceipts = await tx
    .select({ poLineId: receiptLines.poLineId, qty: receiptLines.quantityReceived })
    .from(receiptLines)
    .innerJoin(receipts, eq(receiptLines.receiptId, receipts.id))
    .where(eq(receipts.purchaseOrderId, purchaseOrderId));
  const fullyReceived = allPoLines.length > 0 && allPoLines.every((pl) => {
    if (pl.kind === "SERVICE") {
      return allReceipts.some((r) => r.poLineId === pl.id);
    }
    const got = allReceipts.filter((r) => r.poLineId === pl.id).reduce((sum, r) => sum + r.qty, 0);
    return got >= pl.quantityOrdered;
  });
  if (fullyReceived) {
    await tx.update(purchaseOrders).set({ status: "CLOSED" }).where(eq(purchaseOrders.id, purchaseOrderId));
    await audit(tx, "purchase_order", purchaseOrderId, "CLOSED", actorUserId);
  } else {
    await audit(tx, "receipt", receiptId, "CREATED", actorUserId);
  }
}

export async function addReceipt(
  purchaseOrderId: string,
  lines: ReceiptLineInput[],
  actorUserId: string,
) {
  return db.transaction(async (tx) => {
    // PO row lock serializes receipts so the cumulative check sees committed prior receipts.
    const [po] = await tx
      .select()
      .from(purchaseOrders)
      .where(eq(purchaseOrders.id, purchaseOrderId))
      .for("update");
    if (!po) throw new DomainError("NOT_FOUND", "PO not found");
    if (po.status !== "OPEN") {
      throw new DomainError("INVALID_STATE", `Cannot receive against ${po.status} PO`);
    }

    const merged = mergeReceiptLines(lines);
    await assertReceivable(tx, purchaseOrderId, merged);

    const [receipt] = await tx
      .insert(receipts)
      .values({ purchaseOrderId, receivedByUserId: actorUserId })
      .returning();
    await tx.insert(receiptLines).values(
      merged.map((l) => ({
        receiptId: receipt.id,
        poLineId: l.poLineId,
        quantityReceived: l.quantityReceived,
      })),
    );
    await closeIfFullyReceived(tx, purchaseOrderId, receipt.id, actorUserId);
    return { receiptId: receipt.id };
  });
}
