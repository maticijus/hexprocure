import { describe, it, expect, beforeEach } from "vitest";
import { eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { approvals, requisitionLines, requisitions } from "@/lib/db/schema";
import { seedOrg, truncateAll } from "@/lib/testing/seed";
import {
  submitRequisition,
  decideApproval,
  createPurchaseOrder,
} from "@/lib/services/p2p";

type LineSpec = { quantity: number; unitPriceMinor: number; kind?: "GOODS" | "SERVICE" };

beforeEach(async () => {
  await truncateAll();
});

async function approvedRequisition(lines: LineSpec[]) {
  const s = await seedOrg();
  const [req] = await db
    .insert(requisitions)
    .values({ requesterId: s.requester.id, supplierId: s.supplier.id, costCenterId: s.cc.id })
    .returning();
  await db.insert(requisitionLines).values(
    lines.map((l, i) => ({ requisitionId: req.id, description: `Line ${i}`, ...l })),
  );
  await submitRequisition(req.id, s.requester.id);
  for (const a of await db.select().from(approvals).where(eq(approvals.requisitionId, req.id))) {
    await decideApproval(a.id, a.approverRole === "FINANCE" ? s.finance.id : s.manager.id, "approve");
  }
  return { s, req };
}

async function countPos(requisitionId: string) {
  const { rows } = await db.execute(
    sql`SELECT COUNT(*)::int AS n FROM purchase_orders WHERE requisition_id = ${requisitionId}`,
  );
  return (rows[0] as { n: number }).n;
}

describe("B1 requisition can be ordered once", () => {
  it("marks the requisition ORDERED and rejects a second order with INVALID_STATE", async () => {
    const { s, req } = await approvedRequisition([{ quantity: 2, unitPriceMinor: 1000 }]);
    await createPurchaseOrder(req.id, s.manager.id);

    const [after] = await db.select().from(requisitions).where(eq(requisitions.id, req.id));
    expect(after.status).toBe("ORDERED");
    await expect(createPurchaseOrder(req.id, s.manager.id)).rejects.toMatchObject({
      code: "INVALID_STATE",
    });
    expect(await countPos(req.id)).toBe(1);
  });

  it("two concurrent orders produce exactly one PO", async () => {
    const { s, req } = await approvedRequisition([{ quantity: 2, unitPriceMinor: 1000 }]);
    const results = await Promise.allSettled([
      createPurchaseOrder(req.id, s.manager.id),
      createPurchaseOrder(req.id, s.manager.id),
    ]);

    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect(rejected.reason).toMatchObject({ code: "INVALID_STATE" });
    expect(await countPos(req.id)).toBe(1);
  });
});
