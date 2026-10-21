import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { db, pool } from "@/lib/db";
import { sessions, users } from "@/lib/db/schema";
import { SESSION_COOKIE } from "@/lib/auth";
import { getActor } from "@/lib/api/helpers";
import { startSession } from "@/lib/services/sessions";
import { truncateAll } from "@/lib/testing/seed";
import { POST } from "./route";

beforeEach(async () => {
  await truncateAll();
});

const withCookie = (token?: string) =>
  new Request("http://x/api/v1/auth/logout", {
    method: "POST",
    headers: token ? { cookie: `${SESSION_COOKIE}=${token}` } : {},
  });

describe("POST /api/v1/auth/logout", () => {
  it("revokes only the current session and clears the cookie", async () => {
    const [u] = await db.insert(users).values({ name: "O", email: "o@hex.test" }).returning();
    const current = await startSession(u.id);
    const other = await startSession(u.id);

    const res = await POST(withCookie(current));

    expect(res.status).toBe(200);
    expect(res.headers.get("set-cookie")).toContain("Max-Age=0");
    await expect(getActor(withCookie(current))).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect((await getActor(withCookie(other))).id).toBe(u.id);
    const revoked = await db.select().from(sessions).where(eq(sessions.userId, u.id));
    expect(revoked.filter((r) => r.revokedAt)).toHaveLength(1);
  });

  it("still clears the cookie without a session", async () => {
    const res = await POST(withCookie());
    expect(res.status).toBe(200);
    expect(res.headers.get("set-cookie")).toContain("Max-Age=0");
  });
});

afterAll(async () => {
  await pool.end();
});
