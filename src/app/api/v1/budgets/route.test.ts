import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { db, pool } from "@/lib/db";
import { costCenters } from "@/lib/db/schema";
import { truncateAll } from "@/lib/testing/seed";
import { apiRequest, idParams, sessionCookie } from "@/lib/testing/api";
import { GET as list, POST as create } from "./route";
import { PATCH as patch } from "./[id]/route";
import { POST as archive } from "./[id]/archive/route";

beforeEach(async () => {
  await truncateAll();
});

afterAll(async () => {
  await pool.end();
});

async function costCenterId() {
  const [cc] = await db.insert(costCenters).values({ name: "IT" }).returning();
  return cc.id;
}

describe("/api/v1/budgets", () => {
  it("lets FINANCE create and edit, rejects a second budget for the same month", async () => {
    const finance = await sessionCookie("FINANCE");
    const body = { costCenterId: await costCenterId(), yearMonth: "2026-11", budgetedMinor: 500_000, currency: "EUR" };
    const created = await create(apiRequest(finance, "POST", body));
    expect(created.status).toBe(201);
    const budget = await created.json();
    expect((await create(apiRequest(finance, "POST", body))).status).toBe(409);

    const edited = await patch(apiRequest(finance, "PATCH", { budgetedMinor: 600_000 }), idParams(budget.id));
    expect((await edited.json()).budgetedMinor).toBe(600_000);
    expect((await archive(apiRequest(finance, "POST"), idParams(budget.id))).status).toBe(403);
    expect((await archive(apiRequest(await sessionCookie("ADMIN"), "POST"), idParams(budget.id))).status).toBe(200);
    expect(await (await list(apiRequest(finance))).json()).toEqual({ budgets: [] });
  });

  it("rejects writes from REQUESTER and MANAGER", async () => {
    const body = { costCenterId: await costCenterId(), yearMonth: "2026-11", budgetedMinor: 1, currency: "EUR" };
    for (const role of ["REQUESTER", "MANAGER"] as const) {
      expect((await create(apiRequest(await sessionCookie(role), "POST", body))).status).toBe(403);
    }
  });

  it("validates currency, month format, amount and cost center", async () => {
    const admin = await sessionCookie("ADMIN");
    const res = await create(
      apiRequest(admin, "POST", { costCenterId: "x", yearMonth: "11/2026", budgetedMinor: -5, currency: "EURO" }),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error.message).toBe(
      "costCenterId must be a valid id; yearMonth must look like 2026-01; budgetedMinor must be a whole number of at least 0; currency must be one of EUR, USD, GBP, CZK, PLN, CHF",
    );
    const unknownCc = await create(
      apiRequest(admin, "POST", { costCenterId: crypto.randomUUID(), yearMonth: "2026-11", budgetedMinor: 1, currency: "EUR" }),
    );
    expect(unknownCc.status).toBe(400);
  });
});
