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

describe("/api/v1/cost-centers", () => {
  it("lets ADMIN create, rename and archive", async () => {
    const admin = await sessionCookie("ADMIN");
    const created = await create(apiRequest(admin, "POST", { name: "Marketing" }));
    expect(created.status).toBe(201);
    const cc = await created.json();
    expect((await (await patch(apiRequest(admin, "PATCH", { name: "Brand" }), idParams(cc.id))).json()).name).toBe("Brand");
    expect((await archive(apiRequest(admin, "POST"), idParams(cc.id))).status).toBe(200);
    expect(await (await list(apiRequest(admin))).json()).toEqual({ costCenters: [] });
  });

  it("keeps FINANCE and other roles read-only", async () => {
    const admin = await sessionCookie("ADMIN");
    const cc = await (await create(apiRequest(admin, "POST", { name: "Ops" }))).json();
    for (const role of ["REQUESTER", "MANAGER", "FINANCE"] as const) {
      const cookie = await sessionCookie(role);
      expect((await create(apiRequest(cookie, "POST", { name: "X" }))).status).toBe(403);
      expect((await patch(apiRequest(cookie, "PATCH", { name: "X" }), idParams(cc.id))).status).toBe(403);
      expect((await archive(apiRequest(cookie, "POST"), idParams(cc.id))).status).toBe(403);
      expect((await list(apiRequest(cookie))).status).toBe(200);
    }
  });

  it("validates the name", async () => {
    const admin = await sessionCookie("ADMIN");
    const res = await create(apiRequest(admin, "POST", { name: 7 }));
    expect(res.status).toBe(400);
    expect((await res.json()).error.message).toBe("name is required");
  });
});
