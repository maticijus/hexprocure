import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { db, pool } from "@/lib/db";
import { costCenters } from "@/lib/db/schema";
import { truncateAll } from "@/lib/testing/seed";
import { sessionCookie } from "@/lib/testing/api";
import { POST } from "./route";

beforeEach(async () => {
  await truncateAll();
});

afterAll(async () => {
  await pool.end();
});

describe("POST /api/v1/cost-centers/import", () => {
  it("creates new names, skips existing ones and is ADMIN only", async () => {
    await db.insert(costCenters).values({ name: "IT" });
    const csv = "name\r\nit\r\nMarketing\r\nMarketing\r\n";
    const call = (cookie: string) =>
      POST(new Request("http://x", { method: "POST", headers: { cookie, "content-type": "text/csv" }, body: csv }));

    expect((await call(await sessionCookie("FINANCE"))).status).toBe(403);
    const res = await call(await sessionCookie("ADMIN"));

    expect(await res.json()).toEqual({ created: 1, updated: 0, skipped: 2, errors: [] });
    expect((await db.select().from(costCenters)).map((c) => c.name).sort()).toEqual(["IT", "Marketing"]);
  });
});
