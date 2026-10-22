import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  approvals,
  invoiceLines,
  invoices,
  poLines,
  purchaseOrders,
  receiptLines,
  receipts,
  requisitions,
} from "@/lib/db/schema";
import { createApiToken } from "@/lib/services/api-tokens";
import { createRequisitionWithLine, seedOrg } from "@/lib/testing/seed";

/** One requisition with an approval step, its PO (one received line) and an
 *  EXCEPTION invoice, plus a bearer header for the requester. */
export async function seedReadFixture() {
  const org = await seedOrg();
  const req = await createRequisitionWithLine(org.requester.id, org.supplier.id, org.cc.id, 3, 1000);
  await db.update(requisitions).set({ status: "ORDERED" }).where(eq(requisitions.id, req.id));
  await db.insert(approvals).values({
    requisitionId: req.id,
    approverRole: "MANAGER",
    sequence: 1,
    decision: "approve",
    decidedByUserId: org.manager.id,
  });
  const [po] = await db
    .insert(purchaseOrders)
    .values({ requisitionId: req.id, supplierId: org.supplier.id, costCenterId: org.cc.id })
    .returning();
  const [line] = await db
    .insert(poLines)
    .values({ purchaseOrderId: po.id, description: "Test items", quantityOrdered: 3, unitPriceMinor: 1000 })
    .returning();
  const [receipt] = await db.insert(receipts).values({ purchaseOrderId: po.id }).returning();
  await db.insert(receiptLines).values({ receiptId: receipt.id, poLineId: line.id, quantityReceived: 2 });
  const [invoice] = await db
    .insert(invoices)
    .values({
      supplierId: org.supplier.id,
      purchaseOrderId: po.id,
      number: "INV-1",
      status: "EXCEPTION",
      exceptions: [{ type: "QUANTITY_MISMATCH", invoiceLineIndex: 0, poLineId: line.id, detail: "3 > 2" }],
    })
    .returning();
  await db.insert(invoiceLines).values({ invoiceId: invoice.id, poLineId: line.id, quantity: 3, unitPriceMinor: 1000 });
  const token = await createApiToken({ name: "t", userId: org.requester.id });
  const auth = { authorization: `Bearer ${token.plaintext}` };
  return { ...org, req, po, line, invoice, auth };
}
