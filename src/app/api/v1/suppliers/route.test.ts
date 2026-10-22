import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { pool } from "@/lib/db";
import { truncateAll } from "@/lib/testing/seed";
import { apiRequest, idParams, sessionCookie } from "@/lib/testing/api";
import { GET as list, POST as create } from "./route";
import { GET as getOne, PATCH as patch } from "./[id]/route";
import { POST as archive } from "./[id]/archive/route";

beforeEach(async () => {
  await truncateAll();
});

afterAll(async () => {
  await pool.end();
});

describe("/api/v1/suppliers", () => {
  it("lets FINANCE create and edit, any role read, only ADMIN archive", async () => {
    const finance = await sessionCookie("FINANCE");
    const requester = await sessionCookie("REQUESTER");
    const admin = await sessionCookie("ADMIN");

    const created = await create(apiRequest(finance, "POST", { name: "Acme", email: "orders@acme.test" }));
    expect(created.status).toBe(201);
    const supplier = await created.json();
    expect(supplier).toMatchObject({ name: "Acme", email: "orders@acme.test", archivedAt: null });

    const edited = await patch(apiRequest(finance, "PATCH", { name: "Acme GmbH" }), idParams(supplier.id));
    expect((await edited.json()).name).toBe("Acme GmbH");
    expect((await getOne(apiRequest(requester), idParams(supplier.id))).status).toBe(200);

    expect((await archive(apiRequest(finance, "POST"), idParams(supplier.id))).status).toBe(403);
    expect((await archive(apiRequest(admin, "POST"), idParams(supplier.id))).status).toBe(200);
    expect(await (await list(apiRequest(requester))).json()).toEqual({ suppliers: [] });
    const all = await (await list(apiRequest(requester, "GET", undefined, "http://x/api/v1/suppliers?includeArchived=true"))).json();
    expect(all.suppliers).toHaveLength(1);
  });

  it("rejects REQUESTER and MANAGER writes and anonymous reads", async () => {
    for (const role of ["REQUESTER", "MANAGER"] as const) {
      const res = await create(apiRequest(await sessionCookie(role), "POST", { name: "X" }));
      expect(res.status).toBe(403);
    }
    expect((await list(apiRequest(null))).status).toBe(403);
  });

  it("returns 400 with every validation error, 409 on a duplicate name, 404 on a bad id", async () => {
    const admin = await sessionCookie("ADMIN");
    const bad = await create(apiRequest(admin, "POST", { name: "", email: "nope" }));
    expect(bad.status).toBe(400);
    expect((await bad.json()).error.message).toBe("name is required; email must be a valid email address");
    await create(apiRequest(admin, "POST", { name: "Acme" }));
    expect((await create(apiRequest(admin, "POST", { name: "ACME" }))).status).toBe(409);
    expect((await getOne(apiRequest(admin), idParams("nope"))).status).toBe(404);
    expect((await getOne(apiRequest(admin), idParams(crypto.randomUUID()))).status).toBe(404);
    expect((await create(apiRequest(admin, "POST", "{not json"))).status).toBe(409);
  });
});
