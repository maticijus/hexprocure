import { and, asc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { integrationEvents } from "@/lib/db/schema";
import type { Connector, DeliveryStatus, IntegrationEvent } from "./types";

const registry = new Map<string, Connector[]>();

export function registerConnector(connector: Connector): void {
  for (const t of connector.handles) {
    registry.set(t, [...(registry.get(t) ?? []), connector]);
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

/** Delivers to every connector for the event; the first failure wins. A failed
 *  event is retried whole, so connectors must tolerate repeats. */
async function deliverToAll(connectors: Connector[], event: IntegrationEvent): Promise<DeliveryStatus> {
  const outcomes = await Promise.all(
    connectors.map(async (c): Promise<DeliveryStatus> => {
      try {
        return await c.deliver(event);
      } catch (error) {
        return { ok: false, error: String(error), retryable: true };
      }
    }),
  );
  return outcomes.find((o) => !o.ok) ?? { ok: true };
}

export async function dispatchPendingEvents(limit = 100): Promise<DispatchResult> {
  // Fewest attempts first: events stuck behind a down connector must not starve fresh ones (e.g. the reconnect notification).
  const pending = await db
    .select()
    .from(integrationEvents)
    .where(eq(integrationEvents.status, "PENDING"))
    .orderBy(asc(integrationEvents.attempts), asc(integrationEvents.createdAt))
    .limit(limit);

  const result: DispatchResult = { delivered: 0, failed: 0, skipped: 0 };

  for (const event of pending) {
    const connectors = registry.get(event.eventType);
    if (!connectors?.length) {
      result.skipped++;
      continue;
    }
    const integrationEvent: IntegrationEvent = {
      id: event.id,
      type: event.eventType as IntegrationEvent["type"],
      payload: event.payload,
    };
    const outcome = await deliverToAll(connectors, integrationEvent);
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
