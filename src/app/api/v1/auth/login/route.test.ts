import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from "vitest";
import { pool, db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { hashPassword } from "@/lib/auth";
import { truncateAll } from "@/lib/testing/seed";
import { resetRateLimits } from "@/lib/api/request-guards";
import { POST } from "./route";

const GOOD_PASSWORD = "correct-password";

const login = (email: string, client: string, password = "wrong-password") =>
  POST(
    new Request("https://procure.example.com/api/v1/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": client },
      body: JSON.stringify({ email, password }),
    }),
  );

const failTimes = async (n: number, email: string, client: string) => {
  for (let i = 0; i < n; i++) expect((await login(email, client)).status).toBe(403);
};

beforeEach(async () => {
  await truncateAll();
  resetRateLimits();
  vi.stubEnv("TRUST_PROXY", "true");
});

afterEach(() => vi.unstubAllEnvs());

describe("POST /api/v1/auth/login per-email rate limit", () => {
  it("limits ten failed logins for one email from one client", async () => {
    await failTimes(10, "victim@hex.test", "10.0.0.1");
    const res = await login("victim@hex.test", "10.0.0.1");
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBeTruthy();
  });

  it("normalises the email (case and whitespace) into one bucket", async () => {
    for (let i = 0; i < 10; i++) await login(i % 2 ? " Victim@Hex.test " : "victim@hex.test", "10.1.0.1");
    expect((await login("VICTIM@hex.test", "10.1.0.1")).status).toBe(429);
  });

  it("does not limit a different email", async () => {
    await failTimes(10, "victim@hex.test", "10.2.0.1");
    expect((await login("other@hex.test", "10.2.0.1")).status).toBe(403);
  });

  it("failures from client A do not block client B", async () => {
    await failTimes(10, "victim@hex.test", "10.3.0.1");
    expect((await login("victim@hex.test", "10.3.0.1")).status).toBe(429);
    expect((await login("victim@hex.test", "10.3.0.2")).status).toBe(403);
  });

  it("a successful login resets the email counter", async () => {
    await db.insert(users).values({ name: "V", email: "victim@hex.test", passwordHash: hashPassword(GOOD_PASSWORD) });
    await failTimes(9, "victim@hex.test", "10.4.0.1");
    expect((await login("victim@hex.test", "10.4.0.1", GOOD_PASSWORD)).status).toBe(200);
    await failTimes(10, "victim@hex.test", "10.4.0.1");
  });

  it("successful logins do not count toward the limit", async () => {
    await db.insert(users).values({ name: "V", email: "victim@hex.test", passwordHash: hashPassword(GOOD_PASSWORD) });
    for (let i = 0; i < 15; i++) {
      expect((await login("victim@hex.test", "10.5.0.1", GOOD_PASSWORD)).status).toBe(200);
    }
  });
});

afterAll(async () => {
  await pool.end();
});
