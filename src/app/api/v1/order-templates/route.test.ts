import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { db, pool } from "@/lib/db";
import { costCenters, orderTemplates, suppliers } from "@/lib/db/schema";
import { seedOrg, truncateAll } from "@/lib/testing/seed";
import { apiRequest, sessionCookie } from "@/lib/testing/api";
import { POST } from "./route";

beforeEach(async () => {
  await truncateAll();
});

afterAll(async () => {
  await pool.end();
});

const body = (supplierId: string, costCenterId: string) => ({
  supplierId,
  costCenterId,
  cadence: "MONTHLY",
  lines: [{ description: "Licence", quantity: 1, unitPriceMinor: 100 }],
});

describe("POST /api/v1/order-templates", () => {
  it("creates a template for active master data", async () => {
    const { supplier, cc } = await seedOrg();
    const res = await POST(apiRequest(await sessionCookie("REQUESTER"), "POST", body(supplier.id, cc.id)));
    expect(res.status).toBe(201);
  });

  it.each(["supplier", "cost center"] as const)("rejects an archived %s with 400", async (which) => {
    const { supplier, cc } = await seedOrg();
    if (which === "supplier") await db.update(suppliers).set({ archivedAt: new Date() }).where(eq(suppliers.id, supplier.id));
    else await db.update(costCenters).set({ archivedAt: new Date() }).where(eq(costCenters.id, cc.id));

    const res = await POST(apiRequest(await sessionCookie("REQUESTER"), "POST", body(supplier.id, cc.id)));

    expect(res.status).toBe(400);
    expect(await db.select().from(orderTemplates)).toHaveLength(0);
  });
});
