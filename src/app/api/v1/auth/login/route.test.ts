import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { pool } from "@/lib/db";
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

afterAll(async () => {
  await pool.end();
});
