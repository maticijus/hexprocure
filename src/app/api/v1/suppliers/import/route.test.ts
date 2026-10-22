import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { db, pool } from "@/lib/db";
import { suppliers } from "@/lib/db/schema";
import { truncateAll } from "@/lib/testing/seed";
import { sessionCookie } from "@/lib/testing/api";
import { POST } from "./route";

beforeEach(async () => {
  await truncateAll();
});

afterAll(async () => {
  await pool.end();
});

const upload = (cookie: string, csv: string, type = "text/csv") =>
  POST(new Request("http://x", { method: "POST", headers: { cookie, "content-type": type }, body: csv }));

describe("POST /api/v1/suppliers/import", () => {
  it("upserts by name and reports counts and row errors", async () => {
    const admin = await sessionCookie("ADMIN");
    await db.insert(suppliers).values([
      { name: "Acme", email: "old@acme.test" },
      { name: "Same", email: "same@same.test" },
    ]);
    const csv = [
      "name,email",
      "acme,new@acme.test",
      "Same,same@same.test",
      '"Nord, s.r.o.",info@nord.test',
      ",missing@name.test",
      "Bad Mail,not-an-email",
    ].join("\n");

    const res = await upload(admin, csv);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      created: 1,
      updated: 1,
      skipped: 1,
      errors: [
        { row: 5, message: "name is required" },
        { row: 6, message: "email must be a valid email address" },
      ],
    });
    const names = (await db.select().from(suppliers)).map((s) => `${s.name}:${s.email}`).sort();
    expect(names).toEqual(["Acme:new@acme.test", "Nord, s.r.o.:info@nord.test", "Same:same@same.test"]);
  });

  it("is ADMIN only and rejects a wrong type, bad header, too many rows and too many bytes", async () => {
    expect((await upload(await sessionCookie("FINANCE"), "name\nX")).status).toBe(403);
    const admin = await sessionCookie("ADMIN");
    expect((await upload(admin, "name\nX", "application/json")).status).toBe(400);
    const badHeader = await upload(admin, "title,email\nX,y@z.test");
    expect((await badHeader.json()).error.message).toBe("CSV header must be: name,email");
    const rows = await upload(admin, ["name", ...Array.from({ length: 2001 }, (_, i) => `S${i}`)].join("\n"));
    expect((await rows.json()).error.message).toBe("CSV may have at most 2000 rows");
    const big = await upload(admin, `name\n${"x".repeat(1024 * 1024)}`);
    expect((await big.json()).error.message).toBe("CSV must be at most 1 MB");
    expect(await db.select().from(suppliers)).toEqual([]);
  });

  it("imports a file saved with a byte order mark", async () => {
    const res = await upload(await sessionCookie("ADMIN"), "\uFEFFname,email\nBom Co,bom@co.test");
    expect(await res.json()).toMatchObject({ created: 1, errors: [] });
  });
});
