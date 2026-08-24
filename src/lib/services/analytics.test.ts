import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { sql } from "drizzle-orm";
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
  purchaseOrders,
  poLines,
  invoices,
  invoiceLines,
} from "@/lib/db/schema";
import { truncateAll } from "@/lib/testing/seed";
import { spendByGroup, analyticsSummary } from "./analytics";

beforeEach(async () => {
  await truncateAll();
});

const FINANCE_MONTHS_AGO = (n: number) => {
  const d = new Date();
  d.setMonth(d.getMonth() - n);
  return d;
};

async function approvedInvoice(opts: {
  supplierName: string;
  ccName: string;
  amountMinor: number;
  monthsAgo?: number;
}) {
  const [requester] = await db.insert(users).values({
    name: "R", email: `r-${Math.random()}@hex.test`,
  }).returning();
  const [supplier] = await db.insert(suppliers).values({ name: opts.supplierName }).returning();
  const [cc] = await db.insert(costCenters).values({ name: opts.ccName }).returning();
  await db.insert(budgets).values({
    costCenterId: cc.id,
    yearMonth: new Date().toISOString().slice(0, 7),
    budgetedMinor: 10_000_000,
  });
  await db.insert(approvalRules).values({
    sequence: 1, minMinor: 0, maxMinor: null, approverRole: "MANAGER", currency: "EUR",
  });

  const [req] = await db.insert(requisitions).values({
    requesterId: requester.id, supplierId: supplier.id, costCenterId: cc.id,
  }).returning();
  await db.insert(requisitionLines).values({
    requisitionId: req.id, description: "x", quantity: 1,
    unitPriceMinor: opts.amountMinor,
  });
  await db.insert(approvals).values({
    requisitionId: req.id, approverRole: "MANAGER", sequence: 0,
    decision: "APPROVE", decidedAt: new Date(),
  });
  await db.update(requisitions).set({ status: "APPROVED" }).where(sql`id = ${req.id}`);

  const [po] = await db.insert(purchaseOrders).values({
    requisitionId: req.id, supplierId: supplier.id, costCenterId: cc.id,
  }).returning();
  await db.insert(poLines).values({
    purchaseOrderId: po.id, description: "x", quantityOrdered: 1,
    unitPriceMinor: opts.amountMinor,
  });

  const createdAt = FINANCE_MONTHS_AGO(opts.monthsAgo ?? 0);
  const [inv] = await db.insert(invoices).values({
    supplierId: supplier.id, purchaseOrderId: po.id,
    number: `N-${Math.random()}`, status: "APPROVED", createdAt,
  }).returning();
  await db.update(invoices).set({ createdAt }).where(sql`id = ${inv.id}`);
  await db.insert(invoiceLines).values({
    invoiceId: inv.id, poLineId: (
      await db.execute(sql`SELECT id FROM po_lines LIMIT 1`)
    ).rows[0] ? ((await db.select().from(poLines))[0]?.id ?? null) : null,
    quantity: 1, unitPriceMinor: opts.amountMinor,
  });

  return { supplier: opts.supplierName, cc: opts.ccName, amountMinor: opts.amountMinor };
}

describe("spendByGroup", () => {
  it("aggregates approved-invoice spend by supplier", async () => {
    await approvedInvoice({ supplierName: "Acme", ccName: "IT", amountMinor: 100_000 });
    await approvedInvoice({ supplierName: "Acme", ccName: "IT", amountMinor: 50_000 });
    await approvedInvoice({ supplierName: "Globex", ccName: "IT", amountMinor: 25_000 });

    const rows = await spendByGroup({ groupBy: "supplier" });
    expect(rows.find((r) => r.key === "Acme")).toMatchObject({
      totalMinor: 150_000, documentCount: 2,
    });
    expect(rows.find((r) => r.key === "Globex")).toMatchObject({ totalMinor: 25_000 });
  });

  it("groups by cost center and by month", async () => {
    await approvedInvoice({ supplierName: "A", ccName: "IT", amountMinor: 100_000 });
    await approvedInvoice({ supplierName: "B", ccName: "Facilities", amountMinor: 40_000, monthsAgo: 2 });

    const byCC = await spendByGroup({ groupBy: "costCenter" });
    expect(byCC.map((r) => r.totalMinor).sort((a, b) => b - a)).toEqual([100_000, 40_000]);

    const byMonth = await spendByGroup({ groupBy: "month" });
    expect(byMonth.length).toBeGreaterThanOrEqual(2);
  });

  it("respects from/to filters and excludes non-approved invoices", async () => {
    await approvedInvoice({ supplierName: "A", ccName: "IT", amountMinor: 100_000, monthsAgo: 3 });
    await approvedInvoice({ supplierName: "B", ccName: "IT", amountMinor: 900_000 }); // this month

    const recent = await spendByGroup({
      groupBy: "supplier",
      from: new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10),
      to: new Date().toISOString().slice(0, 10),
    });
    // only the current-month invoice falls inside the window
    expect(recent.some((r) => r.key === "B" && r.totalMinor === 900_000)).toBe(true);
    expect(recent.some((r) => r.key === "A")).toBe(false);
  });

  it("counts only APPROVED invoices in totals", async () => {
    await approvedInvoice({ supplierName: "A", ccName: "IT", amountMinor: 100_000 });
    // an EXCEPTION invoice must not count
    const [inv] = await db.insert(invoices).values({
      supplierId: (await db.select().from(suppliers))[0].id,
      purchaseOrderId: (await db.select().from(purchaseOrders))[0].id,
      number: "X", status: "EXCEPTION",
    }).returning();
    void inv;

    const rows = await spendByGroup({ groupBy: "supplier" });
    expect(rows[0]).toMatchObject({ totalMinor: 100_000, documentCount: 1 });
  });
});

describe("analyticsSummary", () => {
  it("returns KPI block", async () => {
    await approvedInvoice({ supplierName: "Acme", ccName: "IT", amountMinor: 250_000 });
    const s = await analyticsSummary();
    expect(s.approvedTotalMinor).toBe(250_000);
    expect(s.topSupplier.key).toBe("Acme");
    expect(typeof s.invoiceCount).toBe("number");
  });
});

afterAll(async () => {
  await pool.end();
});
