import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { integrationEvents } from "@/lib/db/schema";
import { clearConnectors, dispatchPendingEvents } from "./dispatch";
import { registerConfiguredConnectors } from "./registry";

const payload = { invoiceId: "i1", invoiceNumber: "N1", supplier: "S", currency: "EUR", totalMinor: 100 };

describe("registerConfiguredConnectors", () => {
  let dir: string;
  const fetchMock = vi.fn(async () => new Response("ok", { status: 200 }));

  beforeEach(async () => {
    await db.execute(sql`TRUNCATE integration_events CASCADE`);
    dir = await mkdtemp(join(tmpdir(), "hx-registry-"));
    clearConnectors();
    fetchMock.mockClear();
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("INTEGRATION_WEBHOOK_URL", "https://example.test/hook");
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    clearConnectors();
    await rm(dir, { recursive: true, force: true });
  });

  it("sends one event to both the webhook and the CSV file", async () => {
    vi.stubEnv("INTEGRATION_CSV_DIR", dir);
    registerConfiguredConnectors();
    await db.insert(integrationEvents).values({ eventType: "INVOICE_APPROVED", payload });

    const result = await dispatchPendingEvents();

    expect(result.delivered).toBe(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(await readdir(dir)).toHaveLength(1);
  });

  it("does not register CSV when INTEGRATION_CSV_DIR is unset", async () => {
    vi.stubEnv("INTEGRATION_CSV_DIR", "");
    registerConfiguredConnectors();
    await db.insert(integrationEvents).values({ eventType: "INVOICE_APPROVED", payload });

    await dispatchPendingEvents();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(await readdir(dir)).toHaveLength(0);
  });

  it("is idempotent: calling twice does not double-deliver", async () => {
    registerConfiguredConnectors();
    registerConfiguredConnectors();
    await db.insert(integrationEvents).values({ eventType: "INVOICE_APPROVED", payload });

    await dispatchPendingEvents();

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
