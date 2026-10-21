import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { db, pool } from "@/lib/db";
import { sessions, users } from "@/lib/db/schema";
import { hashPassword } from "@/lib/auth";
import { truncateAll } from "@/lib/testing/seed";
import { resetRateLimits } from "@/lib/api/request-guards";
import { POST } from "./route";

const login = (email: string, ip: string) =>
  POST(
    new Request("https://procure.example.com/api/v1/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json", "x-real-ip": ip },
      body: JSON.stringify({ email, password: "wrong-password" }),
    }),
  );

beforeEach(async () => {
  await truncateAll();
  resetRateLimits();
});

describe("POST /api/v1/auth/login per-email rate limit", () => {
  it("limits ten failed logins for one email regardless of IP", async () => {
    for (let i = 0; i < 10; i++) {
      expect((await login("victim@hex.test", `10.0.0.${i}`)).status).toBe(403);
    }
    const res = await login("victim@hex.test", "10.0.0.200");
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBeTruthy();
  });

  it("normalises the email (case and whitespace) into one bucket", async () => {
    for (let i = 0; i < 10; i++) await login(i % 2 ? " Victim@Hex.test " : "victim@hex.test", `10.1.0.${i}`);
    expect((await login("VICTIM@hex.test", "10.1.0.99")).status).toBe(429);
  });

  it("does not limit a different email", async () => {
    for (let i = 0; i < 10; i++) await login("victim@hex.test", `10.2.0.${i}`);
    expect((await login("other@hex.test", "10.2.0.1")).status).toBe(403);
  });
});

describe("POST /api/v1/auth/login session store", () => {
  async function seedUser() {
    const [u] = await db
      .insert(users)
      .values({ name: "L", email: "l@hex.test", passwordHash: hashPassword("password123") })
      .returning();
    return u;
  }
  const good = (agent?: string) =>
    POST(
      new Request("https://procure.example.com/api/v1/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json", ...(agent ? { "user-agent": agent } : {}) },
        body: JSON.stringify({ email: "l@hex.test", password: "password123" }),
      }),
    );

  it("creates a sessions row for the issued token", async () => {
    const u = await seedUser();
    const res = await good("vitest-agent");
    expect(res.status).toBe(200);
    const [row] = await db.select().from(sessions);
    expect(row.userId).toBe(u.id);
    expect(row.userAgent).toBe("vitest-agent");
    expect(row.revokedAt).toBeNull();
    expect(row.expiresAt.getTime()).toBeGreaterThan(Date.now() + 6 * 24 * 3600 * 1000);
  });

  it("does not create a row for failed logins", async () => {
    await seedUser();
    await login("l@hex.test", "10.9.0.1");
    expect(await db.select().from(sessions)).toHaveLength(0);
  });

  it("purges rows expired more than 30 days ago", async () => {
    const u = await seedUser();
    await db.insert(sessions).values({
      userId: u.id,
      tokenHash: "stale",
      expiresAt: new Date(Date.now() - 31 * 24 * 3600 * 1000),
    });
    await good();
    const hashes = (await db.select().from(sessions)).map((r) => r.tokenHash);
    expect(hashes).not.toContain("stale");
    expect(hashes).toHaveLength(1);
  });
});

afterAll(async () => {
  await pool.end();
});
