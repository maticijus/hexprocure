import { and, asc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { integrationEvents } from "@/lib/db/schema";
import type { Connector, IntegrationEvent } from "./types";

const registry = new Map<string, Connector>();

export function registerConnector(connector: Connector): void {
  for (const t of connector.handles) {
    registry.set(t, connector);
  }
}

export function clearConnectors(): void {
  registry.clear();
}

export interface DispatchResult {
  delivered: number;
  failed: number;
  skipped: number;
}

export async function dispatchPendingEvents(limit = 100): Promise<DispatchResult> {
  const pending = await db
    .select()
    .from(integrationEvents)
    .where(eq(integrationEvents.status, "PENDING"))
    .orderBy(asc(integrationEvents.createdAt))
    .limit(limit);

  const result: DispatchResult = { delivered: 0, failed: 0, skipped: 0 };

  for (const event of pending) {
    const connector = registry.get(event.eventType);
    if (!connector) {
      result.skipped++;
      continue;
    }
    const integrationEvent: IntegrationEvent = {
      id: event.id,
      type: event.eventType as IntegrationEvent["type"],
      payload: event.payload,
    };
    let outcome;
    try {
      outcome = await connector.deliver(integrationEvent);
    } catch (error) {
      outcome = { ok: false, error: String(error), retryable: true };
    }
    const attempts = event.attempts + 1;
    if (outcome.ok) {
      await db
        .update(integrationEvents)
        .set({ status: "DELIVERED", attempts, lastError: null, deliveredAt: new Date() })
        .where(and(eq(integrationEvents.id, event.id), eq(integrationEvents.status, "PENDING")));
      result.delivered++;
    } else {
      await db
        .update(integrationEvents)
        .set({ status: "PENDING", attempts, lastError: outcome.error })
        .where(eq(integrationEvents.id, event.id));
      result.failed++;
    }
  }
  return result;
}
