import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db, pool } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { truncateAll } from "@/lib/testing/seed";
import { POST } from "./route";

const register = (body: Record<string, unknown>) =>
  POST(
    new Request("https://procure.example.com/api/v1/auth/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );

beforeEach(async () => {
  await truncateAll();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("POST /api/v1/auth/register", () => {
  it("ignores a client-supplied role and always creates a REQUESTER", async () => {
    const res = await register({
      name: "Mallory",
      email: "mallory@hex.test",
      password: "password123",
      role: "ADMIN",
    });
    expect(res.status).toBe(201);
    expect((await res.json()).role).toBe("REQUESTER");
    const [row] = await db.select().from(users).where(eq(users.email, "mallory@hex.test"));
    expect(row.role).toBe("REQUESTER");
  });

  it("returns 403 FORBIDDEN in production unless ALLOW_SELF_REGISTRATION=true", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("ALLOW_SELF_REGISTRATION", "");
    const res = await register({ email: "a@hex.test", password: "password123" });
    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe("FORBIDDEN");
    expect(await db.select().from(users)).toHaveLength(0);
  });

  it("allows registration in production when ALLOW_SELF_REGISTRATION=true", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("ALLOW_SELF_REGISTRATION", "true");
    const res = await register({ email: "b@hex.test", password: "password123" });
    expect(res.status).toBe(201);
  });

  it("returns 403 when ALLOW_SELF_REGISTRATION=false outside production", async () => {
    vi.stubEnv("ALLOW_SELF_REGISTRATION", "false");
    const res = await register({ email: "c@hex.test", password: "password123" });
    expect(res.status).toBe(403);
  });
});

afterAll(async () => {
  await pool.end();
});
