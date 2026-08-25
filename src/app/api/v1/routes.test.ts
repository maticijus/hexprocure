import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { eq, sql } from "drizzle-orm";
import { db, pool } from "@/lib/db";
import { TRUNCATE_TABLES, truncateAll } from "@/lib/testing/seed";
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
import { POST as addReceiptRoute } from "@/app/api/v1/purchase-orders/[id]/receipts/route";
import { POST as createInvoiceRoute } from "@/app/api/v1/invoices/route";
import {
  errorToResponse,
  getActor,
} from "@/lib/api/helpers";
import { hashPassword, createSessionToken } from "@/lib/auth";

const SECRET = process.env.AUTH_SECRET ?? "dev-secret-change-me";
const authCookie = (userId: string) =>
  `hexprocure_session=${createSessionToken(userId, SECRET)}`;

const req = (url: string, init?: RequestInit) => new Request(url, init);

async function seed() {
  const [requester] = await db
    .insert(users)
    .values({ name: "R", email: `r-${Date.now()}@hex.test`, passwordHash: hashPassword("password123") })
    .returning();
  const [manager] = await db
    .insert(users)
    .values({ name: "M", email: `m-${Date.now()}@hex.test`, role: "MANAGER", passwordHash: hashPassword("password123") })
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
  await truncateAll();
});

describe("POST /api/v1/requisitions", () => {
  it("creates a requisition (201) with valid body and actor header", async () => {
    const s = await seed();
    const res = await createRequisition(
      req("http://localhost/api/v1/requisitions", {
        method: "POST",
        headers: { "content-type": "application/json", "cookie": authCookie(s.requester.id) },
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
    await seed();
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
        headers: { "content-type": "application/json", "cookie": authCookie(s.requester.id) },
        body: JSON.stringify({ lines: [{ quantity: -1 }] }),
      }),
    );
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error.message).toMatch(/supplierId[\s\S]*quantity/);
  });
});

describe("full HTTP flow: create → submit → decide → order", () => {
  async function orderToOpenPo() {
    const s = await seed();
    const created = await createRequisition(
      req("http://localhost/api/v1/requisitions", {
        method: "POST",
        headers: { "content-type": "application/json", "cookie": authCookie(s.requester.id) },
        body: JSON.stringify({
          supplierId: s.supplier.id,
          costCenterId: s.cc.id,
          lines: [{ description: "Chairs", quantity: 4, unitPriceMinor: 5000 }],
        }),
      }),
    );
    const { id } = await created.json();
    await submit(req("http://x", { method: "POST", headers: { cookie: authCookie(s.requester.id) } }), {
      params: Promise.resolve({ id }),
    } as never);
    const [approval] = await db.select().from(approvals);
    await decide(
      req("http://x", {
        method: "POST",
        headers: { "content-type": "application/json", "cookie": authCookie(s.manager.id) },
        body: JSON.stringify({ decision: "approve" }),
      }),
      { params: Promise.resolve({ id: approval.id }) } as never,
    );
    const ordered = await order(
      req("http://x", { method: "POST", headers: { cookie: authCookie(s.requester.id) } }),
      { params: Promise.resolve({ id }) } as never,
    );
    const { purchaseOrderId } = (await ordered.json()) as { purchaseOrderId: string };
    const poLines = (
      await db.execute(sql`SELECT id FROM po_lines WHERE purchase_order_id = ${purchaseOrderId}`)
    ).rows as { id: string }[];
    return { s, purchaseOrderId, poLineId: poLines[0].id };
  }

  it("returns 201 for PO creation after approval", async () => {
    const s = await seed();
    const created = await createRequisition(
      req("http://localhost/api/v1/requisitions", {
        method: "POST",
        headers: { "content-type": "application/json", "cookie": authCookie(s.requester.id) },
        body: JSON.stringify({
          supplierId: s.supplier.id,
          costCenterId: s.cc.id,
          lines: [{ description: "Monitors", quantity: 2, unitPriceMinor: 25000 }],
        }),
      }),
    );
    const { id } = await created.json();

    const submitted = await submit(req(`http://localhost/x`, { method: "POST", headers: { "cookie": authCookie(s.requester.id) } }), {
      params: Promise.resolve({ id }),
    } as never);
    expect(submitted.status).toBe(200);

    const [approval] = await db.select().from(approvals);
    const decided = await decide(
      req("http://localhost/x", {
        method: "POST",
        headers: { "content-type": "application/json", "cookie": authCookie(s.manager.id) },
        body: JSON.stringify({ decision: "approve" }),
      }),
      { params: Promise.resolve({ id: approval.id }) } as never,
    );
    expect((await decided.json()).requisitionStatus).toBe("APPROVED");

    const ordered = await order(
      req("http://localhost/x", { method: "POST", headers: { "cookie": authCookie(s.requester.id) } }),
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
        headers: { "content-type": "application/json", "cookie": authCookie(s.requester.id) },
        body: JSON.stringify({
          supplierId: s.supplier.id,
          costCenterId: s.cc.id,
          lines: [{ description: "Server", quantity: 1, unitPriceMinor: 99000 }],
        }),
      }),
    );
    const { id } = await created.json();
    await submit(req("http://x", { method: "POST", headers: { "cookie": authCookie(s.requester.id) } }), {
      params: Promise.resolve({ id }),
    } as never);
    const [approval] = await db.select().from(approvals);
    await decide(
      req("http://x", {
        method: "POST",
        headers: { "content-type": "application/json", "cookie": authCookie(s.manager.id) },
        body: JSON.stringify({ decision: "approve" }),
      }),
      { params: Promise.resolve({ id: approval.id }) } as never,
    );

    const ordered = await order(
      req("http://x", { method: "POST", headers: { "cookie": authCookie(s.requester.id) } }),
      { params: Promise.resolve({ id }) } as never,
    );
    expect(ordered.status).toBe(422);
    const err = await ordered.json();
    expect(err.error.code).toBe("BUDGET_EXCEEDED");
  });

describe("POST /api/v1/purchase-orders/[id]/receipts", () => {
  it("records a receipt against an OPEN PO and closes it when fully received", async () => {
    const { s, purchaseOrderId, poLineId } = await orderToOpenPo();

    const res = await addReceiptRoute(
      req("http://localhost/x", {
        method: "POST",
        headers: { "content-type": "application/json", "cookie": authCookie(s.requester.id) },
        body: JSON.stringify({ lines: [{ poLineId, quantityReceived: 4 }] }),
      }),
      { params: Promise.resolve({ id: purchaseOrderId }) } as never,
    );
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.receiptId).toBeDefined();

    const status = (
      await db.execute(sql`SELECT status FROM purchase_orders WHERE id = ${purchaseOrderId}`)
    ).rows as { status: string }[];
    expect(status[0].status).toBe("CLOSED");
  });

  it("returns 404 for an unknown PO and 409 for a closed one", async () => {
    const { s, purchaseOrderId, poLineId } = await orderToOpenPo();

    const missing = await addReceiptRoute(
      req("http://localhost/x", {
        method: "POST",
        headers: { "content-type": "application/json", "cookie": authCookie(s.requester.id) },
        body: JSON.stringify({ lines: [{ poLineId: crypto.randomUUID(), quantityReceived: 1 }] }),
      }),
      { params: Promise.resolve({ id: crypto.randomUUID() }) } as never,
    );
    expect(missing.status).toBe(404);

    await addReceiptRoute(
      req("http://localhost/x", {
        method: "POST",
        headers: { "content-type": "application/json", "cookie": authCookie(s.requester.id) },
        body: JSON.stringify({ lines: [{ poLineId, quantityReceived: 4 }] }),
      }),
      { params: Promise.resolve({ id: purchaseOrderId }) } as never,
    );
    const again = await addReceiptRoute(
      req("http://localhost/x", {
        method: "POST",
        headers: { "content-type": "application/json", "cookie": authCookie(s.requester.id) },
        body: JSON.stringify({ lines: [{ poLineId, quantityReceived: 1 }] }),
      }),
      { params: Promise.resolve({ id: purchaseOrderId }) } as never,
    );
    expect(again.status).toBe(409);
  });
});

  it("POST /api/v1/invoices creates a PENDING invoice (201) and validates body", async () => {
    const { s, purchaseOrderId, poLineId } = await orderToOpenPo();

    const res = await createInvoiceRoute(
      req("http://localhost/x", {
        method: "POST",
        headers: { "content-type": "application/json", "cookie": authCookie(s.requester.id) },
        body: JSON.stringify({
          supplierId: s.supplier.id,
          purchaseOrderId,
          number: "INV-E2E-1",
          lines: [{ poLineId, quantity: 4, unitPriceMinor: 5000 }],
        }),
      }),
    );
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.status).toBe("PENDING");

    const badRequest = await createInvoiceRoute(
      req("http://localhost/x", {
        method: "POST",
        headers: { "content-type": "application/json", "cookie": authCookie(s.requester.id) },
        body: JSON.stringify({ number: "X" }),
      }),
    );
    expect(badRequest.status).toBe(400);
  });

  it("getActor rejects missing, invalid, and unknown sessions", async () => {
    await expect(async () =>
      getActor(req("http://x", {})),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(async () =>
      getActor(req("http://x", { headers: { cookie: "hexprocure_session=garbage" } })),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    const stale = createSessionToken(crypto.randomUUID(), SECRET, -10);
    await expect(async () =>
      getActor(req("http://x", { headers: { cookie: `hexprocure_session=${stale}` } })),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(errorToResponse(new Error("boom")).status).toBe(500);
  });

  it("login endpoint issues a working session cookie end-to-end", async () => {
    const s = await seed();
    const { POST: loginRoute } = await import("@/app/api/v1/auth/login/route");
    const res = await loginRoute(
      req("http://x/api/v1/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: s.requester.email, password: "password123" }),
      }),
    );
    expect(res.status).toBe(200);
    const setCookie = res.headers.get("set-cookie")!;
    expect(setCookie).toContain("HttpOnly");

    const created = await createRequisition(
      req("http://localhost/api/v1/requisitions", {
        method: "POST",
        headers: { "content-type": "application/json", cookie: setCookie.split(";")[0] },
        body: JSON.stringify({
          supplierId: s.supplier.id,
          costCenterId: s.cc.id,
          lines: [{ description: "Keyboard", quantity: 2, unitPriceMinor: 4900 }],
        }),
      }),
    );
    expect(created.status).toBe(201);
  });
});

afterAll(async () => {
  await pool.end();
});
