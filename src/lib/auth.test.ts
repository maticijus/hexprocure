import { createHash } from "node:crypto";
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { db, pool } from "@/lib/db";
import { sessions, users } from "@/lib/db/schema";
import { getAuthSecret } from "@/lib/auth-secret";
import { getActor } from "@/lib/api/helpers";
import { truncateAll } from "@/lib/testing/seed";
import { startSession, purgeExpiredSessions } from "@/lib/services/sessions";
import {
  hashPassword,
  verifyPassword,
  createSessionToken,
  verifySessionToken,
  SESSION_COOKIE,
} from "./auth";

describe("password hashing", () => {
  it("hashes and verifies a password", () => {
    const hash = hashPassword("correct horse battery staple");
    expect(hash).not.toContain("correct horse");
    expect(verifyPassword("correct horse battery staple", hash)).toBe(true);
  });

  it("rejects wrong passwords", () => {
    const hash = hashPassword("secret");
    expect(verifyPassword("Secret", hash)).toBe(false);
    expect(verifyPassword("", hash)).toBe(false);
  });

  it("produces unique salts per hash", () => {
    expect(hashPassword("x")).not.toBe(hashPassword("x"));
  });
});

describe("session tokens", () => {
  const SECRET = "unit-test-secret";

  it("creates and verifies a valid token", () => {
    const token = createSessionToken("user-1", SECRET, 3600);
    const payload = verifySessionToken(token, SECRET);
    expect(payload).toMatchObject({ userId: "user-1" });
    expect(payload!.exp - Math.floor(Date.now() / 1000)).toBeGreaterThan(3500);
  });

  it("issues distinct tokens for the same user within one second", () => {
    expect(createSessionToken("u1", SECRET)).not.toBe(createSessionToken("u1", SECRET));
  });

  it("rejects tokens signed with a different secret", () => {
    const token = createSessionToken("user-1", SECRET, 3600);
    expect(verifySessionToken(token, "other-secret")).toBeNull();
  });

  it("rejects expired tokens", () => {
    const token = createSessionToken("user-1", SECRET, -10);
    expect(verifySessionToken(token, SECRET)).toBeNull();
  });

  it("rejects tampered payloads", () => {
    const token = createSessionToken("user-1", SECRET, 3600);
    const [payload] = token.split(".");
    const tampered = Buffer.from(JSON.stringify({ userId: "admin", exp: 9999999999 })).toString("base64url");
    expect(verifySessionToken(`${tampered}.${payload.split(".")[1]}`, SECRET)).toBeNull();
    expect(verifySessionToken(`${payload}.deadbeef`, SECRET)).toBeNull();
  });

  it("rejects garbage input", () => {
    expect(verifySessionToken("garbage", SECRET)).toBeNull();
    expect(verifySessionToken("", SECRET)).toBeNull();
  });
});

describe("session store", () => {
  const cookieFor = (token: string) =>
    new Request("http://x", { headers: { cookie: `${SESSION_COOKIE}=${token}` } });

  beforeEach(async () => {
    await truncateAll();
  });

  async function user(role: "REQUESTER" | "ADMIN" = "REQUESTER") {
    const [u] = await db
      .insert(users)
      .values({ name: "U", email: `u-${crypto.randomUUID()}@hex.test`, role })
      .returning();
    return u;
  }

  it("startSession stores only the sha256 hash of the token", async () => {
    const u = await user();
    const token = await startSession(u.id, "vitest-agent");
    const [row] = await db.select().from(sessions);
    expect(row.tokenHash).toBe(createHash("sha256").update(token).digest("hex"));
    expect(row.tokenHash).not.toContain(token);
    expect(row.userId).toBe(u.id);
    expect(row.userAgent).toBe("vitest-agent");
    expect(row.revokedAt).toBeNull();
    expect(verifySessionToken(token, getAuthSecret())?.userId).toBe(u.id);
  });

  it("getActor accepts a live session", async () => {
    const u = await user();
    const actor = await getActor(cookieFor(await startSession(u.id)));
    expect(actor.id).toBe(u.id);
  });

  it("getActor rejects a revoked session", async () => {
    const u = await user();
    const token = await startSession(u.id);
    await db.update(sessions).set({ revokedAt: new Date() });
    await expect(getActor(cookieFor(token))).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("getActor rejects a validly signed token that has no session row", async () => {
    const u = await user();
    const legacy = createSessionToken(u.id, getAuthSecret());
    await expect(getActor(cookieFor(legacy))).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("getActor rejects a session whose row expired", async () => {
    const u = await user();
    const token = await startSession(u.id);
    await db.update(sessions).set({ expiresAt: new Date(Date.now() - 1000) });
    await expect(getActor(cookieFor(token))).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("purgeExpiredSessions deletes only rows expired more than 30 days ago", async () => {
    const u = await user();
    const day = 24 * 60 * 60 * 1000;
    const mk = (hash: string, expiresAt: Date) => ({ userId: u.id, tokenHash: hash, expiresAt });
    await db.insert(sessions).values([
      mk("old", new Date(Date.now() - 31 * day)),
      mk("recent-expired", new Date(Date.now() - 2 * day)),
      mk("live", new Date(Date.now() + day)),
    ]);
    await purgeExpiredSessions();
    const left = (await db.select().from(sessions)).map((r) => r.tokenHash).sort();
    expect(left).toEqual(["live", "recent-expired"]);
  });
});

afterAll(async () => {
  await pool.end();
});
