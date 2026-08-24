import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { db, pool } from "@/lib/db";
import {
  orderTemplateLines,
  orderTemplates,
  requisitionLines,
  requisitions,
  users,
} from "@/lib/db/schema";
import { seedOrg, truncateAll } from "@/lib/testing/seed";
import { createOrderTemplate, generateDueRequisitions } from "./recurring";

beforeEach(async () => {
  await truncateAll();
});

const TODAY = "2026-08-24";

async function template(overrides?: Partial<{ cadence: "MONTHLY" | "QUARTERLY" | "YEARLY"; nextRunDate: string; active: boolean; kind: "GOODS" | "SERVICE" }>) {
  const s = await seedOrg();
  const t = await createOrderTemplate({
    name: "SaaS renewals",
    requesterId: s.requester.id,
    supplierId: s.supplier.id,
    costCenterId: s.cc.id,
    cadence: overrides?.cadence ?? "MONTHLY",
    nextRunDate: overrides?.nextRunDate ?? TODAY,
    active: overrides?.active ?? true,
    lines: [
      { description: "CRM license", quantity: 1, unitPriceMinor: 49_900 },
      { description: "Support retainer", quantity: 1, unitPriceMinor: 120_000, kind: overrides?.kind ?? "GOODS" },
    ],
  });
  return { s, templateId: t.id };
}

describe("createOrderTemplate", () => {
  it("persists the template with its lines", async () => {
    const { templateId } = await template();
    const lines = await db.select().from(orderTemplateLines).where(eq(orderTemplateLines.templateId, templateId));
    expect(lines).toHaveLength(2);
    expect(lines.every((l) => l.kind === "GOODS")).toBe(true);
  });
});

describe("generateDueRequisitions", () => {
  it("creates a DRAFT requisition with copied lines and advances next_run_date", async () => {
    const { s, templateId } = await template();
    const result = await generateDueRequisitions(TODAY, s.manager.id);
    expect(result.created).toBe(1);

    const [req] = await db.select().from(requisitions);
    expect(req.status).toBe("DRAFT");
    expect(req.supplierId).toBe(s.supplier.id);

    const lines = await db.select().from(requisitionLines).where(eq(requisitionLines.requisitionId, req.id));
    expect(lines.map((l) => l.description)).toContain("CRM license");

    const [t] = await db.select().from(orderTemplates).where(eq(orderTemplates.id, templateId));
    expect(t.nextRunDate).toBe("2026-09-24");
  });

  it("does not double-generate on a second run the same day", async () => {
    const { templateId } = await template();
    await generateDueRequisitions(TODAY, (await seedOrg()).manager.id);
    const result = await generateDueRequisitions(TODAY, (await seedOrg()).finance.id);
    expect(result.created).toBe(0);
    const [t] = await db.select().from(orderTemplates).where(eq(orderTemplates.id, templateId));
    expect(t.nextRunDate).toBe("2026-09-24");
  });

  it("skips templates that are not yet due or inactive", async () => {
    await template({ nextRunDate: "2026-09-01" });
    await template({ active: false });
    const result = await generateDueRequisitions(TODAY, (await seedOrg()).manager.id);
    expect(result.created).toBe(0);
    const reqs = await db.select().from(requisitions);
    expect(reqs).toHaveLength(0);
  });

  it("respects quarterly and yearly steps", async () => {
    const q = await template({ cadence: "QUARTERLY" });
    const y = await template({ cadence: "YEARLY", nextRunDate: TODAY });
    void y;
    await generateDueRequisitions(TODAY, (await seedOrg()).manager.id);
    const [qt] = await db.select().from(orderTemplates).where(eq(orderTemplates.id, q.templateId));
    expect(qt.nextRunDate).toBe("2026-11-24");
  });
});

afterAll(async () => {
  await pool.end();
});
