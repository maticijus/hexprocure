import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { pool } from "@/lib/db";
import { truncateAll } from "@/lib/testing/seed";
import { seedReadFixture } from "@/lib/testing/read-fixture";
import { GET as list } from "./route";
import { GET as detail } from "./[id]/route";

beforeEach(truncateAll);
afterAll(() => pool.end());

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

describe("GET /api/v1/purchase-orders", () => {
  it("lists with totals, filtered by status and supplier", async () => {
    const f = await seedReadFixture();
    const res = await list(new Request("http://x/p", { headers: f.auth }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      purchaseOrders: [{ id: f.po.id, status: "OPEN", supplier: "Acme GmbH", totalMinor: 3000 }],
    });
    const hit = await list(new Request(`http://x/p?status=OPEN&supplierId=${f.supplier.id}`, { headers: f.auth }));
    expect((await hit.json()).purchaseOrders).toHaveLength(1);
    const miss = await list(new Request("http://x/p?status=CLOSED", { headers: f.auth }));
    expect((await miss.json()).purchaseOrders).toHaveLength(0);
  });

  it("rejects bad filters with 400 and missing auth with 403", async () => {
    const f = await seedReadFixture();
    expect((await list(new Request("http://x/p?supplierId=x", { headers: f.auth }))).status).toBe(400);
    expect((await list(new Request("http://x/p?status=DRAFT", { headers: f.auth }))).status).toBe(400);
    expect((await list(new Request("http://x/p"))).status).toBe(403);
  });

  it("returns lines with ordered, received, acceptance and invoiced quantities", async () => {
    const f = await seedReadFixture();
    const res = await detail(new Request("http://x", { headers: f.auth }), ctx(f.po.id));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      id: f.po.id,
      costCenter: "IT",
      totalMinor: 3000,
      lines: [
        { id: f.line.id, quantityOrdered: 3, quantityReceived: 2, acceptanceCount: 1, quantityInvoiced: 3, amountInvoicedMinor: 0 },
      ],
    });
  });

  it("detail: 404 unknown, 400 malformed, 403 unauthenticated", async () => {
    const f = await seedReadFixture();
    expect((await detail(new Request("http://x", { headers: f.auth }), ctx(crypto.randomUUID()))).status).toBe(404);
    expect((await detail(new Request("http://x", { headers: f.auth }), ctx("nope"))).status).toBe(400);
    expect((await detail(new Request("http://x"), ctx(f.po.id))).status).toBe(403);
  });
});
