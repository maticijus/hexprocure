import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { purchaseOrders, requisitions } from "@/lib/db/schema";
import { seedOrg, truncateAll } from "@/lib/testing/seed";

const migration = () =>
  readFileSync("drizzle/0008_po_requisition_uq_active.sql", "utf8")
    .split("--> statement-breakpoint")
    .map((s) => s.trim());

beforeEach(async () => {
  await truncateAll();
});

async function requisitionWithPo(poStatus: "OPEN" | "CANCELLED") {
  const s = await seedOrg();
  const [req] = await db
    .insert(requisitions)
    .values({
      requesterId: s.requester.id,
      supplierId: s.supplier.id,
      costCenterId: s.cc.id,
      status: "APPROVED",
    })
    .returning();
  await db.insert(purchaseOrders).values({
    requisitionId: req.id,
    supplierId: s.supplier.id,
    costCenterId: s.cc.id,
    currency: "EUR",
    status: poStatus,
  });
  return req.id;
}

async function statusOf(id: string) {
  const [row] = await db.select().from(requisitions).where(eq(requisitions.id, id));
  return row.status;
}

describe("M4 0008 backfill", () => {
  it("marks APPROVED requisitions with a live PO as ORDERED", async () => {
    const live = await requisitionWithPo("OPEN");
    const cancelled = await requisitionWithPo("CANCELLED");
    const backfill = migration().find((s) => /^UPDATE\s+"?requisitions"?/i.test(s));
    expect(backfill).toBeDefined();

    await db.execute(sql.raw(backfill!));

    expect(await statusOf(live)).toBe("ORDERED");
    expect(await statusOf(cancelled)).toBe("APPROVED");
  });
});
