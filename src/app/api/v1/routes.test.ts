import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { eq, sql } from "drizzle-orm";
import { db, pool } from "@/lib/db";
import {
  users,
  suppliers,
  costCenters,
  budgets,
  approvalRules,
  approvals,
} from "@/lib/db/schema";
import { POST as createRequisition } from "@/app/api/v1/requisitions/route";
import { POST as submit } from "@/app/api/v1/requisitions/[id]/submit/route";
import { POST as decide } from "@/app/api/v1/approvals/[id]/decide/route";
import { POST as order } from "@/app/api/v1/requisitions/[id]/order/route";
import {
  errorToResponse,
  getActor,
} from "@/lib/api/helpers";

const req = (url: string, init?: RequestInit) => new Request(url, init);

async function seed() {
  const [requester] = await db
    .insert(users)
    .values({ name: "R", email: `r-${Date.now()}@hex.test` })
    .returning();
  const [manager] = await db
    .insert(users)
    .values({ name: "M", email: `m-${Date.now()}@hex.test`, role: "MANAGER" })
    .returning();
  const [supplier] = await db.insert(suppliers).values({ name: "S" }).returning();
  const [cc] = await db.insert(costCenters).values({ name: "Ops" }).returning();
  await db.insert(budgets).values({
    costCenterId: cc.id,
    yearMonth: new Date().toISOString().slice(0, 7),
    budgetedMinor: 10_000_000,
  });
  await db.insert(approvalRules).values({
    sequence: 1,
    minMinor: 0,
    maxMinor: null,
    approverRole: "MANAGER",
    currency: "EUR",
  });
  return { requester, manager, supplier, cc };
}

beforeEach(async () => {
  for (const table of [
    "audit_events",
    "invoice_lines",
    "invoices",
    "receipt_lines",
    "receipts",
    "po_lines",
    "purchase_orders",
    "budget_reservations",
    "approvals",
    "requisition_lines",
    "requisitions",
    "approval_rules",
    "budgets",
    "cost_centers",
    "suppliers",
    "users",
  ]) {
    await db.execute(sql.raw(`TRUNCATE ${table} CASCADE`));
  }
});

describe("POST /api/v1/requisitions", () => {
  it("creates a requisition (201) with valid body and actor header", async () => {
    const s = await seed();
    const res = await createRequisition(
      req("http://localhost/api/v1/requisitions", {
        method: "POST",
        headers: { "content-type": "application/json", "x-user-id": s.requester.id },
        body: JSON.stringify({
          supplierId: s.supplier.id,
          costCenterId: s.cc.id,
          lines: [{ description: "Chairs", quantity: 5, unitPriceMinor: 8900 }],
        }),
      }),
    );
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.status).toBe("DRAFT");
  });

  it("rejects missing actor header with 403", async () => {
    const s = await seed();
    const res = await createRequisition(
      req("http://localhost/api/v1/requisitions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      }),
    );
    expect(res.status).toBe(403);
  });

  it("returns 400 with field-level messages on invalid body", async () => {
    const s = await seed();
    const res = await createRequisition(
      req("http://localhost/api/v1/requisitions", {
        method: "POST",
        headers: { "content-type": "application/json", "x-user-id": s.requester.id },
        body: JSON.stringify({ lines: [{ quantity: -1 }] }),
      }),
    );
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error.message).toMatch(/supplierId[\s\S]*quantity/);
  });
});

describe("full HTTP flow: create → submit → decide → order", () => {
  it("returns 201 for PO creation after approval", async () => {
    const s = await seed();
    const created = await createRequisition(
      req("http://localhost/api/v1/requisitions", {
        method: "POST",
        headers: { "content-type": "application/json", "x-user-id": s.requester.id },
        body: JSON.stringify({
          supplierId: s.supplier.id,
          costCenterId: s.cc.id,
          lines: [{ description: "Monitors", quantity: 2, unitPriceMinor: 25000 }],
        }),
      }),
    );
    const { id } = await created.json();

    const submitted = await submit(req(`http://localhost/x`, { method: "POST", headers: { "x-user-id": s.requester.id } }), {
      params: Promise.resolve({ id }),
    } as never);
    expect(submitted.status).toBe(200);

    const [approval] = await db.select().from(approvals);
    const decided = await decide(
      req("http://localhost/x", {
        method: "POST",
        headers: { "content-type": "application/json", "x-user-id": s.manager.id },
        body: JSON.stringify({ decision: "approve" }),
      }),
      { params: Promise.resolve({ id: approval.id }) } as never,
    );
    expect((await decided.json()).requisitionStatus).toBe("APPROVED");

    const ordered = await order(
      req("http://localhost/x", { method: "POST", headers: { "x-user-id": s.requester.id } }),
      { params: Promise.resolve({ id }) } as never,
    );
    expect(ordered.status).toBe(201);
    expect((await ordered.json()).totalMinor).toBe(50000);
  });

  it("maps domain errors to 422 for budget overrun", async () => {
    const s = await seed();
    await db.update(budgets).set({ budgetedMinor: 100 }).where(eq(budgets.budgetedMinor, 10_000_000));

    const created = await createRequisition(
      req("http://localhost/api/v1/requisitions", {
        method: "POST",
        headers: { "content-type": "application/json", "x-user-id": s.requester.id },
        body: JSON.stringify({
          supplierId: s.supplier.id,
          costCenterId: s.cc.id,
          lines: [{ description: "Server", quantity: 1, unitPriceMinor: 99000 }],
        }),
      }),
    );
    const { id } = await created.json();
    await submit(req("http://x", { method: "POST", headers: { "x-user-id": s.requester.id } }), {
      params: Promise.resolve({ id }),
    } as never);
    const [approval] = await db.select().from(approvals);
    await decide(
      req("http://x", {
        method: "POST",
        headers: { "content-type": "application/json", "x-user-id": s.manager.id },
        body: JSON.stringify({ decision: "approve" }),
      }),
      { params: Promise.resolve({ id: approval.id }) } as never,
    );

    const ordered = await order(
      req("http://x", { method: "POST", headers: { "x-user-id": s.requester.id } }),
      { params: Promise.resolve({ id }) } as never,
    );
    expect(ordered.status).toBe(422);
    const err = await ordered.json();
    expect(err.error.code).toBe("BUDGET_EXCEEDED");
  });

  it("getActor rejects unknown user ids", async () => {
    await expect(async () =>
      getActor(req("http://x", { headers: { "x-user-id": crypto.randomUUID() } })),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(errorToResponse(new Error("boom")).status).toBe(500);
  });
});

afterAll(async () => {
  await pool.end();
});
