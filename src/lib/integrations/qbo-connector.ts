import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { qboSyncMap } from "@/lib/db/schema";
import {
  poEventToQboPurchaseOrder,
  invoiceEventToQboBill,
} from "./qbo";
import { getValidAccessToken, hasHealthyQboConnection } from "./qbo-connection";
import type { Connector, DeliveryStatus, IntegrationEvent } from "./types";

const API_BASE_SANDBOX = "https://sandbox-quickbooks.api.intuit.com/v3/company";
const API_BASE_LIVE = "https://quickbooks.api.intuit.com/v3/company";

function apiBase(): string {
  return process.env.QBO_SANDBOX === "false" ? API_BASE_LIVE : API_BASE_SANDBOX;
}

function mapEventToQboPayload(event: IntegrationEvent): Record<string, unknown> {
  switch (event.type) {
    case "PO_CREATED":
      return { ...poEventToQboPurchaseOrder(event) };
    case "INVOICE_APPROVED":
      return { ...invoiceEventToQboBill(event) };
    default:
      throw new Error(`QBO connector does not handle ${event.type}`);
  }
}

export interface QboConnectorDeps {
  fetchImpl?: typeof fetch;
}

/** QBO connector: consumes PO/invoice events and creates the corresponding
 *  documents in QuickBooks Online. Idempotent via qbo_sync_map — an event is
 *  delivered to QBO at most once even across repeated dispatch runs. */
export function createQboConnector(deps: QboConnectorDeps = {}): Connector {
  const fetchImpl = deps.fetchImpl ?? fetch;
  return {
    name: "qbo",
    handles: ["PO_CREATED", "INVOICE_APPROVED"],
    async deliver(event): Promise<DeliveryStatus> {
      const healthy = await hasHealthyQboConnection();
      if (!healthy) {
        return { ok: true, response: { skipped: true } };
      }

      const [already] = await db
        .select()
        .from(qboSyncMap)
        .where(eq(qboSyncMap.eventId, event.id));
      if (already) {
        return { ok: true, response: { skipped: true } };
      }

      let payload: Record<string, unknown>;
      try {
        payload = mapEventToQboPayload(event);
      } catch (error) {
        return { ok: false, error: String(error), retryable: false };
      }

      const qboEntity = event.type === "PO_CREATED" ? "purchaseorder" : "bill";
      const localEntityId =
        String((event.payload as Record<string, unknown>).purchaseOrderId ??
              (event.payload as Record<string, unknown>).invoiceId ?? "");

      try {
        const { accessToken, realmId } = await getValidAccessToken(fetchImpl);
        const res = await fetchImpl(`${apiBase()}/${realmId}/${qboEntity}`, {
          method: "POST",
          headers: {
            authorization: `Bearer ${accessToken}`,
            "content-type": "application/json",
            accept: "application/json",
          },
          body: JSON.stringify(payload),
        });
        if (!res.ok) {
          const retryable = res.status >= 500 || res.status === 429;
          if (res.status === 401 || res.status === 403) {
            const { markRevoked } = await import("./qbo-connection");
            await markRevoked(`Intuit rejected request: HTTP ${res.status}`);
          }
          return { ok: false, error: `QBO API returned HTTP ${res.status}`, retryable };
        }
        const body = (await res.json()) as Record<string, { Id?: string }> & { Id?: string };
        const qboId = body.PurchaseOrder?.Id ?? body.Bill?.Id ?? body.Id ?? "";
        await db.insert(qboSyncMap).values({
          eventId: event.id,
          entityType: event.type === "PO_CREATED" ? "PO" : "BILL",
          localEntityId,
          qboEntityId: qboId,
        });
        return { ok: true, response: { qboEntityId: qboId } };
      } catch (error) {
        const message = String(error);
        if (/re-auth|expired|No active/i.test(message)) {
          // connection-level problem: leave event PENDING for after reconnect
          return { ok: false, error: message, retryable: true };
        }
        return { ok: false, error: message, retryable: true };
      }
    },
  };
}
