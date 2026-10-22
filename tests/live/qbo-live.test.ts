import { beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { integrationEvents, qboSyncMap } from "@/lib/db/schema";
import { seedOrg, truncateAll } from "@/lib/testing/seed";
import { upsertQboConnection } from "@/lib/integrations/qbo-connection";
import { createQboConnector } from "@/lib/integrations/qbo-connector";

const REQUIRED = [
  "QBO_CLIENT_ID",
  "QBO_CLIENT_SECRET",
  "QBO_LIVE_REALM_ID",
  "QBO_LIVE_REFRESH_TOKEN",
  "INTEGRATION_ENC_KEY",
] as const;

/** Acceptance criterion 2 against the real Intuit sandbox. Run by hand via
 *  `npm run test:qbo-live`; never part of the default suite. Missing
 *  configuration fails loudly so a green run always means a real round trip. */
describe("QBO sandbox contract smoke", () => {
  beforeAll(() => {
    const missing = REQUIRED.filter((name) => !process.env[name]);
    if (missing.length > 0) throw new Error(`Missing env for live QBO smoke: ${missing.join(", ")}`);
    if (process.env.QBO_SANDBOX === "false") throw new Error("Refusing to run the smoke against live QBO");
  });

  it("refreshes the stored token, pushes a PO once and skips the second dispatch", async () => {
    await truncateAll();
    const s = await seedOrg();
    await upsertQboConnection({
      realmId: process.env.QBO_LIVE_REALM_ID!,
      accessToken: "expired-placeholder",
      refreshToken: process.env.QBO_LIVE_REFRESH_TOKEN!,
      accessExpiresIn: 0,
      userId: s.requester.id,
    });
    const [row] = await db
      .insert(integrationEvents)
      .values({
        eventType: "PO_CREATED",
        payload: {
          purchaseOrderId: crypto.randomUUID(),
          supplier: process.env.QBO_LIVE_VENDOR_ID ?? "1",
          costCenter: "IT",
          currency: "USD",
          issuedOn: new Date().toISOString().slice(0, 10),
          totalMinor: 10000,
          lines: [{ description: "Contract smoke", quantity: 1, unitPriceMinor: 10000 }],
        },
      })
      .returning();
    const event = { id: row.id, type: "PO_CREATED" as const, payload: row.payload };
    const connector = createQboConnector();

    const first = await connector.deliver(event);
    expect(first).toMatchObject({ ok: true });
    const second = await connector.deliver(event);
    expect(second).toMatchObject({ ok: true, response: { skipped: true } });
    expect(await db.select().from(qboSyncMap)).toHaveLength(1);
  });
});
