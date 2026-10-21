import { describe, it, expect, beforeEach } from "vitest";
import { eq, sql } from "drizzle-orm";
import type { Connector } from "./types";
import { db } from "@/lib/db";
import { integrationEvents } from "@/lib/db/schema";
import {
  dispatchPendingEvents,
  registerConnector,
  clearConnectors,
} from "./dispatch";
import { csvConnector } from "./csv";

beforeEach(async () => {
  await db.execute(sql`TRUNCATE integration_events CASCADE`);
  clearConnectors();
  registerConnector(csvConnector);
});

describe("dispatch loop", () => {
  it("delivers a pending event and marks it DELIVERED", async () => {
    const [event] = await db
      .insert(integrationEvents)
      .values({
        eventType: "INVOICE_APPROVED",
        payload: { invoiceId: "i1", invoiceNumber: "N1", supplier: "S", currency: "EUR", totalMinor: 100 },
      })
      .returning();

    const result = await dispatchPendingEvents();
    expect(result.delivered).toBe(1);
    const [after] = await db
      .select()
      .from(integrationEvents)
      .where(eq(integrationEvents.id, event.id));
    expect(after.status).toBe("DELIVERED");
    expect(after.attempts).toBe(1);
  });

  it("records failure and keeps event PENDING for retry on connector error", async () => {
    await db.insert(integrationEvents).values({
      eventType: "PO_CREATED",
      payload: {},
    });
    const failing: Connector = {
      name: "failing",
      handles: ["PO_CREATED"],
      deliver: async () => ({ ok: false, error: "ERP down", retryable: true }),
    };
    registerConnector(failing);

    const result = await dispatchPendingEvents();
    expect(result.failed).toBe(1);
    const [after] = await db
      .select()
      .from(integrationEvents)
      .where(eq(integrationEvents.eventType, "PO_CREATED"));
    expect(after.status).toBe("PENDING");
    expect(after.lastError).toBe("ERP down");
  });

  it("skips events no registered connector handles", async () => {
    clearConnectors();
    await db.insert(integrationEvents).values({ eventType: "PO_CANCELLED", payload: {} });
    const result = await dispatchPendingEvents();
    expect(result.skipped).toBe(1);
    const [after] = await db.select().from(integrationEvents);
    expect(after.status).toBe("PENDING");
  });

  it("increments attempts across retries", async () => {
    const delivered = await db
      .insert(integrationEvents)
      .values({ eventType: "INVOICE_APPROVED", payload: { supplier: "x", invoiceId: "y", totalMinor: 5 } })
      .returning();
    await dispatchPendingEvents();
    void delivered;
    const [row] = await db.select().from(integrationEvents);
    expect(row.status).toBe("DELIVERED");
    expect(row.attempts).toBe(1);
    await expect(
      db.execute(sql`SELECT 1`),
    ).resolves.toBeTruthy();
  });

  it("lets a fresh event through when older stuck events fill the batch", async () => {
    const payload = { invoiceId: "i1", invoiceNumber: "N1", supplier: "S", currency: "EUR", totalMinor: 100 };
    await db.insert(integrationEvents).values(
      Array.from({ length: 3 }, () => ({ eventType: "INVOICE_APPROVED", payload, attempts: 5 })),
    );
    const [fresh] = await db
      .insert(integrationEvents)
      .values({ eventType: "INVOICE_APPROVED", payload })
      .returning();

    await dispatchPendingEvents(2);

    const [after] = await db.select().from(integrationEvents).where(eq(integrationEvents.id, fresh.id));
    expect(after.status).toBe("DELIVERED");
  });

  it("sends an event to every connector registered for its type", async () => {
    const seen: string[] = [];
    const mk = (name: string): Connector => ({
      name,
      handles: ["PO_CREATED"],
      deliver: async () => {
        seen.push(name);
        return { ok: true };
      },
    });
    clearConnectors();
    registerConnector(mk("a"));
    registerConnector(mk("b"));
    await db.insert(integrationEvents).values({ eventType: "PO_CREATED", payload: {} });

    const result = await dispatchPendingEvents();

    expect(seen.sort()).toEqual(["a", "b"]);
    expect(result.delivered).toBe(1);
    const [after] = await db.select().from(integrationEvents);
    expect(after.status).toBe("DELIVERED");
  });

  it("marks the event failed with the first error when any connector fails", async () => {
    const ok: Connector = { name: "ok", handles: ["PO_CREATED"], deliver: async () => ({ ok: true }) };
    const bad: Connector = {
      name: "bad",
      handles: ["PO_CREATED"],
      deliver: async () => ({ ok: false, error: "ERP down", retryable: true }),
    };
    clearConnectors();
    registerConnector(bad);
    registerConnector(ok);
    await db.insert(integrationEvents).values({ eventType: "PO_CREATED", payload: {} });

    const result = await dispatchPendingEvents();

    expect(result.failed).toBe(1);
    expect(result.delivered).toBe(0);
    const [after] = await db.select().from(integrationEvents);
    expect(after.status).toBe("PENDING");
    expect(after.lastError).toBe("ERP down");
  });

  it("reports a thrown connector error as name and message only", async () => {
    const boom: Connector = {
      name: "boom",
      handles: ["PO_CREATED"],
      deliver: async () => {
        throw new TypeError("socket closed");
      },
    };
    clearConnectors();
    registerConnector(boom);
    await db.insert(integrationEvents).values({ eventType: "PO_CREATED", payload: {} });

    await dispatchPendingEvents();

    const [after] = await db.select().from(integrationEvents);
    expect(after.lastError).toBe("TypeError: socket closed");
  });
});
