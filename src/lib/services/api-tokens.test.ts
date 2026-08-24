import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { db, pool } from "@/lib/db";
import { apiTokens } from "@/lib/db/schema";
import { seedOrg, truncateAll } from "@/lib/testing/seed";
import {
  createApiToken,
  verifyApiToken,
  listApiTokens,
  revokeApiToken,
} from "./api-tokens";

beforeEach(async () => {
  await truncateAll();
});

describe("createApiToken", () => {
  it("returns plaintext once and stores only the hash", async () => {
    const s = await seedOrg();
    const result = await createApiToken({ name: "cron", userId: s.requester.id });

    expect(result.plaintext.startsWith("hxp_")).toBe(true);

    const [row] = await db.select().from(apiTokens);
    expect(row.tokenHash).toBe(createHash("sha256").update(result.plaintext).digest("hex"));
    expect(JSON.stringify(row)).not.toContain(result.plaintext);
  });

  it("requires a name and an existing user", async () => {
    const s = await seedOrg();
    await expect(createApiToken({ name: "", userId: s.requester.id })).rejects.toMatchObject({
      code: "VALIDATION",
    });
    await expect(
      createApiToken({ name: "x", userId: "00000000-0000-0000-0000-000000000000" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("verifyApiToken", () => {
  it("resolves a valid token to its owning user", async () => {
    const s = await seedOrg();
    const { plaintext } = await createApiToken({ name: "cron", userId: s.manager.id });

    const actor = await verifyApiToken(plaintext);
    expect(actor).toMatchObject({ id: s.manager.id, role: "MANAGER" });

    const [row] = await db.select().from(apiTokens);
    expect(row.lastUsedAt).toBeTruthy();
  });

  it("rejects unknown, revoked, and garbage tokens with null", async () => {
    const s = await seedOrg();
    const { plaintext } = await createApiToken({ name: "t", userId: s.manager.id });
    const [row] = await db.select().from(apiTokens);
    await db.update(apiTokens).set({ revokedAt: new Date() }).where(eq(apiTokens.id, row.id));

    expect(await verifyApiToken(plaintext)).toBeNull(); // revoked
    expect(await verifyApiToken("hxp_unknown")).toBeNull();
    expect(await verifyApiToken("garbage")).toBeNull();
    expect(await verifyApiToken("")).toBeNull();
  });
});

describe("listing + revocation", () => {
  it("lists metadata without secrets", async () => {
    const s = await seedOrg();
    await createApiToken({ name: "one", userId: s.requester.id });
    await createApiToken({ name: "two", userId: s.requester.id });

    const tokens = await listApiTokens(s.requester.id);
    expect(tokens.map((t) => t.name).sort()).toEqual(["one", "two"]);
    for (const t of tokens) {
      expect(t).not.toHaveProperty("tokenHash");
      expect(JSON.stringify(t)).not.toMatch(/[a-z0-9]{43}/);
    }
  });

  it("revokes by id", async () => {
    const s = await seedOrg();
    const created = await createApiToken({ name: "n", userId: s.requester.id });
    await revokeApiToken(created.id);
    const [row] = await db.select().from(apiTokens);
    expect(row.revokedAt).toBeTruthy();
  });
});

afterAll(async () => {
  await pool.end();
});
