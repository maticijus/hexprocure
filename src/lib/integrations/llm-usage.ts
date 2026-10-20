import { db } from "@/lib/db";
import { llmUsage } from "@/lib/db/schema";

export interface LlmUsageEntry {
  purpose: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  durationMs: number;
  actorUserId: string | null;
  error?: string;
}

export async function recordLlmUsage(entry: LlmUsageEntry): Promise<void> {
  await db.insert(llmUsage).values({ ...entry, error: entry.error ?? null });
}
