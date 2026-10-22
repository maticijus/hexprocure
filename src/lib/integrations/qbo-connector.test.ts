import { describe, it, expect, beforeEach, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  integrationsConnections,
  integrationEvents,
  qboSyncMap,
} from "@/lib/db/schema";
import { seedOrg, truncateAll } from "@/lib/testing/seed";
import { upsertQboConnection } from "./qbo-connection";
import { createQboConnector } from "./qbo-connector";
import { clearConnectors, dispatchPendingEvents, registerConnector } from "./dispatch";
import type { IntegrationEvent } from "./types";

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

/** Routes by URL like the QBO API: vendor query, vendor create, document create. */
function qboRouter(opts: { queryVendors?: { Id: string }[]; createdVendorId?: string; createStatus?: number } = {}) {
  return vi.fn(async (url: string, init?: RequestInit) => {
    if (url.includes("/query")) {
      return new Response(JSON.stringify({ QueryResponse: opts.queryVendors?.length ? { Vendor: opts.queryVendors } : {} }), { status: 200 });
    }
    if (url.endsWith("/vendor")) {
      if (opts.createStatus) return new Response('{"Fault":[]}', { status: opts.createStatus });
      return new Response(JSON.stringify({ Vendor: { Id: opts.createdVendorId ?? "V-new" } }), { status: 200 });
    }
    return qboOk("77");
  }) as unknown as ReturnType<typeof vi.fn> & typeof fetch;
}

const callsTo = (fetchMock: ReturnType<typeof vi.fn>, part: string) =>
  fetchMock.mock.calls.filter(([url]) => String(url).includes(part));

const PO_ID = crypto.randomUUID();
const INV_ID = crypto.randomUUID();

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
              purchaseOrderId: PO_ID,
              supplier: s.supplier.name,
              supplierId: s.supplier.id,
              costCenter: "IT",
              currency: "EUR",
              issuedOn: "2026-08-24",
              totalMinor: 10000,
              lines: [{ description: "Laptop", quantity: 1, unitPriceMinor: 10000 }],
            }
          : {
              invoiceId: INV_ID,
              invoiceNumber: "INV-1",
              supplier: s.supplier.name,
              supplierId: s.supplier.id,
              currency: "EUR",
              totalMinor: 10000,
              purchaseOrderId: PO_ID,
            },
    })
    .returning();
  const normalized = {
    id: event.id,
    type: event.eventType,
    payload: event.payload,
  } as unknown as IntegrationEvent;
  return { event: normalized, supplier: s.supplier };
}

describe("createQboConnector", () => {
  it("uses a cached VENDOR sync row without calling the vendor API", async () => {
    const fetchMock = qboRouter();
    const connector = createQboConnector({ fetchImpl: fetchMock });
    const { event, supplier } = await seedConnectionAndEvent("PO_CREATED");
    await db.insert(qboSyncMap).values({ entityType: "VENDOR", localEntityId: supplier.id, qboEntityId: "V-cached" });

    const result = await connector.deliver(event);
    expect(result.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain("sandbox-quickbooks.api.intuit.com/v3/company/realm-9/purchaseorder");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer access-1");
    expect(JSON.parse(init.body).VendorRef).toEqual({ value: "V-cached", name: supplier.name });
  });

  it("finds the vendor by DisplayName, caches it and links the PO to its id", async () => {
    const fetchMock = qboRouter({ queryVendors: [{ Id: "V-found" }] });
    const connector = createQboConnector({ fetchImpl: fetchMock });
    const { event, supplier } = await seedConnectionAndEvent("PO_CREATED");

    expect((await connector.deliver(event)).ok).toBe(true);
    const [query] = callsTo(fetchMock, "/query");
    expect(decodeURIComponent(String(query[0]))).toContain(`select * from Vendor where DisplayName = '${supplier.name}'`);
    expect(callsTo(fetchMock, "/vendor")).toHaveLength(0);
    const [po] = callsTo(fetchMock, "/purchaseorder");
    expect(JSON.parse(po[1].body).VendorRef).toEqual({ value: "V-found", name: supplier.name });
    const [row] = await db.select().from(qboSyncMap).where(eq(qboSyncMap.entityType, "VENDOR"));
    expect(row).toMatchObject({ localEntityId: supplier.id, qboEntityId: "V-found" });
  });

  it("escapes single quotes in the DisplayName query", async () => {
    const fetchMock = qboRouter({ queryVendors: [{ Id: "V-q" }] });
    const { event } = await seedConnectionAndEvent("PO_CREATED");
    (event.payload as Record<string, unknown>).supplier = "O'Neil & Sons";

    await createQboConnector({ fetchImpl: fetchMock }).deliver(event);
    const [query] = callsTo(fetchMock, "/query");
    expect(decodeURIComponent(String(query[0]))).toContain("DisplayName = 'O\\'Neil & Sons'");
  });

  it("creates the vendor with DisplayName and email when QBO has none", async () => {
    const fetchMock = qboRouter({ createdVendorId: "V-created" });
    const connector = createQboConnector({ fetchImpl: fetchMock });
    const { event, supplier } = await seedConnectionAndEvent("INVOICE_APPROVED");

    expect((await connector.deliver(event)).ok).toBe(true);
    const [create] = callsTo(fetchMock, "/vendor");
    expect(JSON.parse(create[1].body)).toEqual({
      DisplayName: supplier.name,
      PrimaryEmailAddr: { Address: supplier.email },
    });
    const [bill] = callsTo(fetchMock, "/bill");
    expect(JSON.parse(bill[1].body).VendorRef).toEqual({ value: "V-created", name: supplier.name });
    const rows = await db.select().from(qboSyncMap);
    expect(rows.map((r) => r.entityType).sort()).toEqual(["BILL", "VENDOR"]);
    expect(rows.find((r) => r.entityType === "VENDOR")).toMatchObject({ localEntityId: supplier.id, qboEntityId: "V-created" });
  });

  it("reuses the created vendor for a second document of the same supplier", async () => {
    const fetchMock = qboRouter({ createdVendorId: "V-once" });
    const connector = createQboConnector({ fetchImpl: fetchMock });
    const { event, supplier } = await seedConnectionAndEvent("PO_CREATED");
    await connector.deliver(event);
    const [row] = await db
      .insert(integrationEvents)
      .values({
        eventType: "INVOICE_APPROVED",
        payload: { invoiceId: INV_ID, invoiceNumber: "INV-2", supplier: supplier.name, supplierId: supplier.id, currency: "EUR", totalMinor: 500 },
      })
      .returning();

    const bill = { id: row.id, type: row.eventType, payload: row.payload } as unknown as IntegrationEvent;
    expect((await connector.deliver(bill)).ok).toBe(true);
    expect(callsTo(fetchMock, "/vendor")).toHaveLength(1);
    expect(callsTo(fetchMock, "/query")).toHaveLength(1);
    expect(JSON.parse(callsTo(fetchMock, "/bill")[0][1].body).VendorRef.value).toBe("V-once");
  });

  it("falls back to the supplier name for events queued before supplierId existed", async () => {
    const fetchMock = qboRouter({ queryVendors: [{ Id: "V-legacy" }] });
    const { event, supplier } = await seedConnectionAndEvent("PO_CREATED");
    delete (event.payload as Record<string, unknown>).supplierId;

    expect((await createQboConnector({ fetchImpl: fetchMock }).deliver(event)).ok).toBe(true);
    const [row] = await db.select().from(qboSyncMap).where(eq(qboSyncMap.entityType, "VENDOR"));
    expect(row.localEntityId).toBe(supplier.id);
  });

  it("treats a vendor lookup failure as retryable and a vendor create 4xx as non-retryable", async () => {
    const { event } = await seedConnectionAndEvent("PO_CREATED");
    const lookup = vi.fn().mockResolvedValue(new Response("{}", { status: 400 }));
    const a = await createQboConnector({ fetchImpl: lookup as unknown as typeof fetch }).deliver(event);
    expect(a).toMatchObject({ ok: false, retryable: true });

    const create = qboRouter({ createStatus: 400 });
    const b = await createQboConnector({ fetchImpl: create }).deliver(event);
    expect(b).toMatchObject({ ok: false, retryable: false });
    expect(callsTo(create, "/purchaseorder")).toHaveLength(0);
  });

  it("records a sync-map row so a second delivery is skipped (idempotent)", async () => {
    const fetchMock = qboRouter({ queryVendors: [{ Id: "V1" }] });
    const connector = createQboConnector({ fetchImpl: fetchMock });
    const { event } = await seedConnectionAndEvent("PO_CREATED");

    await connector.deliver(event);
    const calls = fetchMock.mock.calls.length;

    const maps = await db.select().from(qboSyncMap).where(eq(qboSyncMap.entityType, "PO"));
    expect(maps).toHaveLength(1);
    expect(maps[0].qboEntityId).toBe("77");
    expect(maps[0].eventId).toBe(event.id);

    const second = await createQboConnector({ fetchImpl: fetchMock as unknown as typeof fetch }).deliver(event);
    expect(second.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(calls); // no second API call
  });

  it("treats QBO 4xx as non-retryable and surfaces the error", async () => {
    const fetchMock = vi.fn(async (url: string) =>
      String(url).includes("/query")
        ? new Response(JSON.stringify({ QueryResponse: { Vendor: [{ Id: "V1" }] } }), { status: 200 })
        : new Response('{"Fault":[]}', { status: 400 }),
    );
    const connector = createQboConnector({ fetchImpl: fetchMock as unknown as typeof fetch });
    const { event } = await seedConnectionAndEvent("INVOICE_APPROVED");

    const result = await connector.deliver(event);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.retryable).toBe(false);
    expect(!result.ok && result.error).toContain("400");
  });

  it("leaves the event PENDING and makes no API call when the connection is not healthy", async () => {
    const fetchMock = vi.fn().mockResolvedValue(qboOk("1"));
    const { event } = await seedConnectionAndEvent("PO_CREATED");
    await db.update(integrationsConnections).set({ status: "REVOKED" });
    clearConnectors();
    registerConnector(createQboConnector({ fetchImpl: fetchMock as unknown as typeof fetch }));

    const result = await dispatchPendingEvents();

    expect(result).toMatchObject({ delivered: 0, failed: 1 });
    expect(fetchMock).not.toHaveBeenCalled();
    const [after] = await db.select().from(integrationEvents).where(eq(integrationEvents.id, event.id));
    expect(after.status).toBe("PENDING");
    expect(after.deliveredAt).toBeNull();
    expect(after.lastError).toMatch(/not active/i);
  });
});
