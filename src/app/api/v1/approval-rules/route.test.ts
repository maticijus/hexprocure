import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { pool } from "@/lib/db";
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

const band = (minMinor: number, maxMinor: number | null, approverRole = "MANAGER") => ({
  minMinor,
  maxMinor,
  approverRole,
  currency: "EUR",
});

describe("/api/v1/approval-rules", () => {
  it("lets ADMIN build a chain and rejects an overlapping bounded band", async () => {
    const admin = await sessionCookie("ADMIN");
    const first = await create(apiRequest(admin, "POST", band(0, 100_000)));
    expect(first.status).toBe(201);
    expect(await first.json()).toMatchObject({ sequence: 1, minMinor: 0, maxMinor: 100_000 });
    expect((await create(apiRequest(admin, "POST", band(100_000, null, "FINANCE")))).status).toBe(201);

    const overlap = await create(apiRequest(admin, "POST", band(50_000, 200_000)));
    expect(overlap.status).toBe(400);
    expect((await overlap.json()).error.message).toBe("This amount band overlaps step 1");
    expect((await (await list(apiRequest(admin))).json()).approvalRules).toHaveLength(2);
  });

  it("rejects max not above min and an overlapping edit", async () => {
    const admin = await sessionCookie("ADMIN");
    const res = await create(apiRequest(admin, "POST", band(500, 100)));
    expect(res.status).toBe(400);
    expect((await res.json()).error.message).toBe("maxMinor must be greater than minMinor");

    await create(apiRequest(admin, "POST", band(0, 1_000)));
    const second = await (await create(apiRequest(admin, "POST", band(1_000, 2_000)))).json();
    const edit = await patch(apiRequest(admin, "PATCH", { minMinor: 500 }), idParams(second.id));
    expect(edit.status).toBe(400);
    expect((await patch(apiRequest(admin, "PATCH", { approverRole: "FINANCE" }), idParams(second.id))).status).toBe(200);
  });

  it("keeps every other role read-only", async () => {
    const admin = await sessionCookie("ADMIN");
    const rule = await (await create(apiRequest(admin, "POST", band(0, null)))).json();
    for (const role of ["REQUESTER", "MANAGER", "FINANCE"] as const) {
      const cookie = await sessionCookie(role);
      expect((await create(apiRequest(cookie, "POST", band(0, 10)))).status).toBe(403);
      expect((await patch(apiRequest(cookie, "PATCH", { minMinor: 1 }), idParams(rule.id))).status).toBe(403);
      expect((await archive(apiRequest(cookie, "POST"), idParams(rule.id))).status).toBe(403);
      expect((await list(apiRequest(cookie))).status).toBe(200);
    }
    expect((await archive(apiRequest(admin, "POST"), idParams(rule.id))).status).toBe(200);
  });

  it("validates role, currency and amounts", async () => {
    const admin = await sessionCookie("ADMIN");
    const res = await create(apiRequest(admin, "POST", { minMinor: "10", approverRole: "CEO", currency: "BTC" }));
    expect(res.status).toBe(400);
    expect((await res.json()).error.message).toBe(
      "minMinor must be a whole number of at least 0; approverRole must be one of MANAGER, FINANCE, ADMIN; currency must be one of EUR, USD, GBP, CZK, PLN, CHF",
    );
  });

  it("rejects a patch that puts max below the stored min, and two patches that only clash once merged", async () => {
    const admin = await sessionCookie("ADMIN");
    const rule = await (await create(apiRequest(admin, "POST", band(100, 1000)))).json();

    const low = await patch(apiRequest(admin, "PATCH", { maxMinor: 50 }), idParams(rule.id));
    expect(low.status).toBe(400);
    expect((await low.json()).error.message).toBe("maxMinor must be greater than minMinor");

    const [a, b] = await Promise.all([
      patch(apiRequest(admin, "PATCH", { minMinor: 600 }), idParams(rule.id)),
      patch(apiRequest(admin, "PATCH", { maxMinor: 500 }), idParams(rule.id)),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 400]);
    const stored = (await (await list(apiRequest(admin))).json()).approvalRules[0];
    expect(stored.minMinor).toBeLessThan(stored.maxMinor);
  });
});
