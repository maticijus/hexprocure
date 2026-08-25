import { describe, it, expect, afterAll } from "vitest";
import { GET } from "./route";
import { pool } from "@/lib/db";

describe("GET /api/health", () => {
  it("returns ok with database reachable, no auth required", async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.status).toBe("ok");
    expect(data.database).toBe(true);
  });

  afterAll(async () => {
    await pool.end();
  });
});
