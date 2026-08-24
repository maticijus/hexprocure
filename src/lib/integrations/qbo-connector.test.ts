import { describe, it, expect, beforeEach, vi } from "vitest";
import { db } from "@/lib/db";
import {
  integrationsConnections,
  integrationEvents,
  qboSyncMap,
} from "@/lib/db/schema";
import { seedOrg, truncateAll } from "@/lib/testing/seed";
import { upsertQboConnection } from "./qbo-connection";
import { createQboConnector } from "./qbo-connector";

const KEYS = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";

beforeEach(async () => {
  process.env.INTEGRATION_ENC_KEY = KEYS;
  process.env.QBO_CLIENT_ID = "cid";
  process.env.QBO_CLIENT_SECRET = "csec";
  await truncateAll();
});

function qboOk(qboId: string) {
  return new Response(JSON.stringify({ PurchaseOrder: { Id: qboId }, Id: qboId }), { status: 200 });
}

async function seedConnectionAndEvent(eventType: "PO_CREATED" | "INVOICE_APPROVED") {
  const s = await seedOrg();
  await upsertQboConnection({
    realmId: "realm-9",
    accessToken: "access-1",
    refreshToken: "refresh-1",
    accessExpiresIn: 3600,
    userId: s.requester.id,
  });
  const [event] = await db
    .insert(integrationEvents)
    .values({
      eventType,
      payload:
        eventType === "PO_CREATED"
          ? {
              purchaseOrderId: "po-1",
              supplier: "Acme",
              costCenter: "IT",
              currency: "EUR",
              issuedOn: "2026-08-24",
              totalMinor: 10000,
              lines: [{ description: "Laptop", quantity: 1, unitPriceMinor: 10000 }],
            }
          : {
              invoiceId: "inv-1",
              invoiceNumber: "INV-1",
              supplier: "Acme",
              currency: "EUR",
              totalMinor: 10000,
              purchaseOrderId: "po-1",
            },
    })
    .returning();
  return { event };
}

describe("createQboConnector", () => {
  it("maps the event and POSTs to the sandbox QBO API with bearer auth", async () => {
    const fetchMock = vi.fn().mockResolvedValue(qboOk("77"));
    const connector = createQboConnector({ fetchImpl: fetchMock as unknown as typeof fetch });
    const { event } = await seedConnectionAndEvent("PO_CREATED");

    const result = await connector.deliver(event);
    expect(result.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain("sandbox-quickbooks.api.intuit.com/v3/company/realm-9/purchaseorder");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer access-1");
    const body = JSON.parse(init.body);
    expect(body.VendorRef).toBe("Acme");
  });

  it("records a sync-map row so a second delivery is skipped (idempotent)", async () => {
    const fetchMock = vi.fn().mockResolvedValue(qboOk("77"));
    const connector = createQboConnector({ fetchImpl: fetchMock as unknown as typeof fetch });
    const { event } = await seedConnectionAndEvent("PO_CREATED");

    await connector.deliver(event);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const maps = await db.select().from(qboSyncMap);
    expect(maps).toHaveLength(1);
    expect(maps[0].qboEntityId).toBe("77");
    expect(maps[0].eventId).toBe(event.id);

    const second = await createQboConnector({ fetchImpl: fetchMock as unknown as typeof fetch }).deliver(event);
    expect(second.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1); // no second API call
  });

  it("treats QBO 4xx as non-retryable and surfaces the error", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{"Fault":[]}', { status: 400 }));
    const connector = createQboConnector({ fetchImpl: fetchMock as unknown as typeof fetch });
    const { event } = await seedConnectionAndEvent("INVOICE_APPROVED");

    const result = await connector.deliver(event);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.retryable).toBe(false);
    expect(!result.ok && result.error).toContain("400");
  });

  it("skips delivery when no healthy connection exists", async () => {
    const fetchMock = vi.fn().mockResolvedValue(qboOk("1"));
    const connector = createQboConnector({ fetchImpl: fetchMock as unknown as typeof fetch });
    const { event } = await seedConnectionAndEvent("PO_CREATED");
    await db.update(integrationsConnections).set({ status: "EXPIRED" });

    const result = await connector.deliver(event);
    expect(result.ok).toBe(true);
    expect(
      result.ok && (result.response as { skipped?: boolean } | undefined)?.skipped,
    ).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
