import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { pool } from "@/lib/db";
import { truncateAll } from "@/lib/testing/seed";
import { sessionCookie } from "@/lib/testing/api";
import { csvImportRoute } from "./master-data-routes";

beforeEach(async () => {
  await truncateAll();
});

afterAll(async () => {
  await pool.end();
});

/** A chunked body: undici sets no Content-Length for a stream. */
function streamed(cookie: string, chunks: number, chunkSize: number) {
  let sent = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (sent++ === chunks) return controller.close();
      controller.enqueue(new Uint8Array(chunkSize).fill(120));
    },
  });
  return new Request("http://x", {
    method: "POST",
    headers: { cookie, "content-type": "text/csv" },
    body,
    duplex: "half",
  } as RequestInit);
}

describe("csvImportRoute", () => {
  it("answers 413 and never parses a body that grows past the cap without Content-Length", async () => {
    const importCsv = vi.fn();
    const post = csvImportRoute(importCsv, 1000);
    const request = streamed(await sessionCookie("ADMIN"), 50, 100);
    expect(request.headers.get("content-length")).toBeNull();

    const res = await post(request);

    expect(res.status).toBe(413);
    expect((await res.json()).error.message).toBe("CSV must be at most 1 MB");
    expect(importCsv).not.toHaveBeenCalled();
  });

  it("passes a body within the cap to the importer", async () => {
    const importCsv = vi.fn().mockResolvedValue({ created: 0 });
    const res = await csvImportRoute(importCsv, 1000)(streamed(await sessionCookie("ADMIN"), 3, 100));
    expect(res.status).toBe(200);
    expect(importCsv.mock.calls[0][0]).toHaveLength(300);
  });
});
