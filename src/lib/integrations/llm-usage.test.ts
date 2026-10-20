import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { db, pool } from "@/lib/db";
import { llmUsage } from "@/lib/db/schema";
import { seedOrg, truncateAll } from "@/lib/testing/seed";
import { recordLlmUsage } from "./llm-usage";

beforeEach(async () => {
  await truncateAll();
});

afterAll(async () => {
  await pool.end();
});

describe("recordLlmUsage", () => {
  it("inserts one row per successful call", async () => {
    const s = await seedOrg();
    await recordLlmUsage({
      purpose: "invoice_lines",
      model: "claude-opus-5-5",
      inputTokens: 120,
      outputTokens: 45,
      durationMs: 830,
      actorUserId: s.finance.id,
    });
    const rows = await db.select().from(llmUsage);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      purpose: "invoice_lines",
      model: "claude-opus-5-5",
      inputTokens: 120,
      outputTokens: 45,
      durationMs: 830,
      actorUserId: s.finance.id,
      error: null,
    });
  });

  it("records failures with zero tokens and the error text", async () => {
    await recordLlmUsage({
      purpose: "invoice_lines",
      model: "claude-opus-5-5",
      inputTokens: 0,
      outputTokens: 0,
      durationMs: 12,
      actorUserId: null,
      error: "LLM rate limit reached",
    });
    const [row] = await db.select().from(llmUsage);
    expect(row.error).toBe("LLM rate limit reached");
    expect(row.inputTokens).toBe(0);
    expect(row.actorUserId).toBeNull();
  });
});
