import { and, asc, eq, sql } from "drizzle-orm";
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

/** Delivers to each connector not yet recorded as delivered for the event and
 *  records every success immediately, so a retry calls only the failed ones.
 *  The first failure wins. Returns the outcome and the names now delivered. */
async function deliverToPending(
  connectors: Connector[],
  event: IntegrationEvent,
  done: readonly string[],
): Promise<{ outcome: DeliveryStatus; delivered: string[] }> {
  const delivered = new Set(done);
  const outcomes = await Promise.all(
    connectors
      .filter((c) => !delivered.has(c.name))
      .map(async (c): Promise<DeliveryStatus> => {
        let outcome: DeliveryStatus;
        try {
          outcome = await c.deliver(event);
        } catch (error) {
          return { ok: false, error: String(error), retryable: true };
        }
        if (outcome.ok) {
          delivered.add(c.name);
          await db
            .update(integrationEvents)
            .set({ deliveredConnectors: sql`${integrationEvents.deliveredConnectors} || ${JSON.stringify([c.name])}::jsonb` })
            .where(eq(integrationEvents.id, event.id));
        }
        return outcome;
      }),
  );
  // A retryable failure wins: a non-retryable one must not end retries for a connector that can still succeed.
  const failures = outcomes.filter((o) => !o.ok);
  const outcome = failures.find((o) => o.retryable) ?? failures[0] ?? { ok: true };
  return { outcome, delivered: [...delivered] };
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
    const { outcome, delivered } = await deliverToPending(connectors, integrationEvent, event.deliveredConnectors);
    const attempts = event.attempts + 1;
    if (outcome.ok && connectors.every((c) => delivered.includes(c.name))) {
      await db
        .update(integrationEvents)
        .set({ status: "DELIVERED", attempts, lastError: null, deliveredAt: new Date() })
        .where(and(eq(integrationEvents.id, event.id), eq(integrationEvents.status, "PENDING")));
      result.delivered++;
    } else {
      await db
        .update(integrationEvents)
        .set({
          status: !outcome.ok && !outcome.retryable ? "FAILED" : "PENDING",
          attempts,
          lastError: outcome.ok ? null : outcome.error,
        })
        .where(eq(integrationEvents.id, event.id));
      result.failed++;
    }
  }
  return result;
}
