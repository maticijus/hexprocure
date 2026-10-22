import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { pool } from "@/lib/db";
import { truncateAll } from "@/lib/testing/seed";
import { seedReadFixture } from "@/lib/testing/read-fixture";
import { GET as list } from "./route";
import { GET as detail } from "./[id]/route";

beforeEach(truncateAll);
afterAll(() => pool.end());

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

describe("GET /api/v1/invoices", () => {
  it("lists with totals in the PO currency, filtered by status", async () => {
    const f = await seedReadFixture();
    const res = await list(new Request("http://x/i", { headers: f.auth }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      invoices: [{ id: f.invoice.id, number: "INV-1", status: "EXCEPTION", currency: "EUR", totalMinor: 3000 }],
    });
    const miss = await list(new Request("http://x/i?status=APPROVED", { headers: f.auth }));
    expect((await miss.json()).invoices).toHaveLength(0);
  });

  it("rejects bad filters with 400 and missing auth with 403", async () => {
    const f = await seedReadFixture();
    expect((await list(new Request("http://x/i?status=NOPE", { headers: f.auth }))).status).toBe(400);
    expect((await list(new Request("http://x/i"))).status).toBe(403);
  });

  it("returns lines and the match exceptions", async () => {
    const f = await seedReadFixture();
    const res = await detail(new Request("http://x", { headers: f.auth }), ctx(f.invoice.id));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      number: "INV-1",
      status: "EXCEPTION",
      totalMinor: 3000,
      exceptions: [{ type: "QUANTITY_MISMATCH", detail: "3 > 2" }],
      lines: [{ poLineId: f.line.id, quantity: 3, unitPriceMinor: 1000, amountMinor: null, lineTotalMinor: 3000 }],
    });
  });

  it("detail: 404 unknown, 400 malformed, 403 unauthenticated", async () => {
    const f = await seedReadFixture();
    expect((await detail(new Request("http://x", { headers: f.auth }), ctx(crypto.randomUUID()))).status).toBe(404);
    expect((await detail(new Request("http://x", { headers: f.auth }), ctx("nope"))).status).toBe(400);
    expect((await detail(new Request("http://x"), ctx(f.invoice.id))).status).toBe(403);
  });
});
