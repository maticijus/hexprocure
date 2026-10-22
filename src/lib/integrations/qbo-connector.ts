import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { qboSyncMap, suppliers } from "@/lib/db/schema";
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

function mapEventToQboPayload(event: IntegrationEvent, vendorId: string): Record<string, unknown> {
  switch (event.type) {
    case "PO_CREATED":
      return { ...poEventToQboPurchaseOrder(event, vendorId) };
    case "INVOICE_APPROVED":
      return { ...invoiceEventToQboBill(event, vendorId) };
    default:
      throw new Error(`QBO connector does not handle ${event.type}`);
  }
}

/** QBO query strings escape backslash and single quote with a backslash. */
const escapeQuery = (value: string) => value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");

class QboVendorError extends Error {
  constructor(message: string, readonly retryable: boolean) {
    super(message);
  }
}

export interface QboConnectorDeps {
  fetchImpl?: typeof fetch;
}

type QboCall = (path: string, init?: RequestInit) => Promise<Response>;

/** Local supplier -> QBO Vendor Id: cached sync row, else match by DisplayName,
 *  else create. Events queued before `supplierId` existed fall back to the name. */
async function resolveVendorId(
  p: Record<string, unknown>,
  call: QboCall,
  revokeOnAuthFailure: (res: Response) => Promise<void>,
): Promise<string> {
  const name = p.supplier;
  if (typeof name !== "string" || !name) {
    throw new QboVendorError("Event payload is missing required field: supplier", false);
  }
  // Legacy events carry only the name, which is not unique: refuse to guess.
  // Errors name the supplier id or a count, never the name (stored in last_error).
  const matches = await db
    .select()
    .from(suppliers)
    .where(typeof p.supplierId === "string" ? eq(suppliers.id, p.supplierId) : eq(suppliers.name, name))
    .limit(2);
  if (matches.length > 1) {
    throw new QboVendorError("Supplier name matches more than one supplier; event needs a supplierId", false);
  }
  const [supplier] = matches;
  if (!supplier) {
    throw new QboVendorError(
      `Supplier not found for QBO vendor sync${typeof p.supplierId === "string" ? ` (id ${p.supplierId})` : ""}`,
      false,
    );
  }

  const isVendor = (supplierId: string) =>
    and(eq(qboSyncMap.entityType, "VENDOR"), eq(qboSyncMap.localEntityId, supplierId));
  const [cached] = await db.select().from(qboSyncMap).where(isVendor(supplier.id));
  if (cached) return cached.qboEntityId;

  const findByName = async (): Promise<string | undefined> => {
    const query = `select * from Vendor where DisplayName = '${escapeQuery(supplier.name)}'`;
    const found = await call(`query?query=${encodeURIComponent(query)}`);
    if (!found.ok) {
      await revokeOnAuthFailure(found);
      throw new QboVendorError(`QBO vendor lookup returned HTTP ${found.status}`, true);
    }
    return ((await found.json()) as { QueryResponse?: { Vendor?: { Id: string }[] } }).QueryResponse
      ?.Vendor?.[0]?.Id;
  };

  let vendorId = await findByName();
  if (!vendorId) {
    const created = await call("vendor", {
      method: "POST",
      body: JSON.stringify({
        DisplayName: supplier.name,
        ...(supplier.email ? { PrimaryEmailAddr: { Address: supplier.email } } : {}),
      }),
    });
    if (created.ok) {
      vendorId = ((await created.json()) as { Vendor?: { Id?: string } }).Vendor?.Id;
      if (!vendorId) throw new QboVendorError("QBO vendor create returned no Id", true);
    } else {
      await revokeOnAuthFailure(created);
      const retryable = created.status >= 500 || created.status === 429;
      // 4xx: Intuit rejects a DisplayName already used by a Vendor or Customer (Fault 6240);
      // a vendor that appeared since our lookup (concurrent dispatch) is usable.
      if (!retryable && created.status !== 401 && created.status !== 403) vendorId = await findByName();
      if (!vendorId) throw new QboVendorError(`QBO vendor create returned HTTP ${created.status}`, retryable);
    }
  }
  await db
    .insert(qboSyncMap)
    .values({ entityType: "VENDOR", localEntityId: supplier.id, qboEntityId: vendorId })
    .onConflictDoNothing();
  // A concurrent dispatcher may have mapped this supplier first: the stored row wins.
  const [mapped] = await db.select().from(qboSyncMap).where(isVendor(supplier.id));
  return mapped?.qboEntityId ?? vendorId;
}

/** QBO connector: consumes PO/invoice events and creates the corresponding
 *  documents in QuickBooks Online. Idempotent via qbo_sync_map - an event is
 *  delivered to QBO at most once even across repeated dispatch runs. */
export function createQboConnector(deps: QboConnectorDeps = {}): Connector {
  const fetchImpl = deps.fetchImpl ?? fetch;
  return {
    name: "qbo",
    handles: ["PO_CREATED", "INVOICE_APPROVED"],
    async deliver(event): Promise<DeliveryStatus> {
      const healthy = await hasHealthyQboConnection();
      if (!healthy) {
        return { ok: false, error: "QBO connection is not active; reconnect to resume sync", retryable: true };
      }

      const [already] = await db
        .select()
        .from(qboSyncMap)
        .where(eq(qboSyncMap.eventId, event.id));
      if (already) {
        return { ok: true, response: { skipped: true } };
      }

      const p = event.payload as Record<string, unknown>;
      const qboEntity = event.type === "PO_CREATED" ? "purchaseorder" : "bill";
      const localEntityId = String(p.purchaseOrderId ?? p.invoiceId ?? "");

      try {
        const { accessToken, realmId } = await getValidAccessToken(fetchImpl);
        const call = (path: string, init: RequestInit = {}) =>
          fetchImpl(`${apiBase()}/${realmId}/${path}`, {
            ...init,
            headers: {
              authorization: `Bearer ${accessToken}`,
              "content-type": "application/json",
              accept: "application/json",
            },
          });
        // Intuit rejected our credentials: stop pushing until an admin reconnects.
        const revokeOnAuthFailure = async (res: Response) => {
          if (res.status === 401 || res.status === 403) {
            const { markRevoked } = await import("./qbo-connection");
            await markRevoked(`Intuit rejected request: HTTP ${res.status}`);
          }
        };

        let vendorId: string;
        try {
          vendorId = await resolveVendorId(p, call, revokeOnAuthFailure);
        } catch (error) {
          if (error instanceof QboVendorError) {
            return { ok: false, error: error.message, retryable: error.retryable };
          }
          throw error;
        }

        let payload: Record<string, unknown>;
        try {
          payload = mapEventToQboPayload(event, vendorId);
        } catch (error) {
          return { ok: false, error: String(error), retryable: false };
        }

        const res = await call(qboEntity, { method: "POST", body: JSON.stringify(payload) });
        if (!res.ok) {
          const retryable = res.status >= 500 || res.status === 429;
          await revokeOnAuthFailure(res);
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
