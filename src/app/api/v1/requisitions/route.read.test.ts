import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { pool } from "@/lib/db";
import { truncateAll } from "@/lib/testing/seed";
import { seedReadFixture } from "@/lib/testing/read-fixture";
import { GET as list } from "./route";
import { GET as detail } from "./[id]/route";

beforeEach(truncateAll);
afterAll(() => pool.end());

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

describe("GET /api/v1/requisitions", () => {
  it("lists with total, supplier and cost center, filtered by status and cost center", async () => {
    const f = await seedReadFixture();
    const res = await list(new Request("http://x/api/v1/requisitions", { headers: f.auth }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      limit: 50,
      offset: 0,
      requisitions: [
        { id: f.req.id, status: "ORDERED", currency: "EUR", supplier: "Acme GmbH", costCenter: "IT", totalMinor: 3000 },
      ],
    });
    const hit = await list(new Request(`http://x/r?status=ORDERED&costCenterId=${f.cc.id}`, { headers: f.auth }));
    expect((await hit.json()).requisitions).toHaveLength(1);
    const miss = await list(new Request("http://x/r?status=DRAFT", { headers: f.auth }));
    expect((await miss.json()).requisitions).toHaveLength(0);
  });

  it("rejects bad filters with 400 and missing auth with 403", async () => {
    const f = await seedReadFixture();
    for (const q of ["status=NOPE", "limit=101", "limit=0", "costCenterId=x", "offset=-1"]) {
      expect((await list(new Request(`http://x/r?${q}`, { headers: f.auth }))).status).toBe(400);
    }
    expect((await list(new Request("http://x/r"))).status).toBe(403);
  });

  it("returns the detail with lines, approval steps and the PO id", async () => {
    const f = await seedReadFixture();
    const res = await detail(new Request("http://x", { headers: f.auth }), ctx(f.req.id));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      id: f.req.id,
      requester: "Requester Rita",
      totalMinor: 3000,
      lines: [{ description: "Test items", quantity: 3, unitPriceMinor: 1000 }],
      approvals: [{ sequence: 1, approverRole: "MANAGER", decision: "approve", decidedBy: "Manager Max" }],
      purchaseOrderId: f.po.id,
    });
  });

  it("detail: 404 unknown, 400 malformed, 403 unauthenticated", async () => {
    const f = await seedReadFixture();
    expect((await detail(new Request("http://x", { headers: f.auth }), ctx(crypto.randomUUID()))).status).toBe(404);
    expect((await detail(new Request("http://x", { headers: f.auth }), ctx("nope"))).status).toBe(400);
    expect((await detail(new Request("http://x"), ctx(f.req.id))).status).toBe(403);
  });
});
