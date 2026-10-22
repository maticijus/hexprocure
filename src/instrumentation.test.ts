import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { integrationEvents } from "@/lib/db/schema";
import { clearConnectors } from "@/lib/integrations/dispatch";
import { register } from "./instrumentation";

describe("instrumentation scheduler", () => {
  const fetchMock = vi.fn(async () => new Response("ok", { status: 200 }));

  beforeEach(async () => {
    await db.execute(sql`TRUNCATE integration_events CASCADE`);
    clearConnectors();
    vi.stubEnv("NEXT_RUNTIME", "nodejs");
    vi.stubEnv("INTEGRATION_DISPATCH_INTERVAL_MS", "20");
    vi.stubEnv("INTEGRATION_WEBHOOK_URL", "https://example.test/hook");
    vi.stubEnv("INTEGRATION_CSV_DIR", "");
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    clearConnectors();
  });

  it("delivers a PENDING event in a fresh process without the route being called", async () => {
    const [event] = await db
      .insert(integrationEvents)
      .values({ eventType: "PO_CREATED", payload: { purchaseOrderId: "p1" } })
      .returning();

    await register();

    await vi.waitFor(async () => {
      const [after] = await db.select().from(integrationEvents).where(eq(integrationEvents.id, event.id));
      expect(after.status).toBe("DELIVERED");
    });
    expect(fetchMock).toHaveBeenCalled();
  });
});
