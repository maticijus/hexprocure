import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { db } from "@/lib/db";
import { auditEvents, integrationEvents, integrationsConnections, users } from "@/lib/db/schema";
import { seedOrg, truncateAll } from "@/lib/testing/seed";
import {
  getValidAccessToken,
  markRevoked,
  revokeConnection,
  upsertQboConnection,
} from "./qbo-connection";
import { createQboConnector } from "./qbo-connector";

const SENTINELS = ["SENTINEL-ACCESS-1", "SENTINEL-REFRESH-1", "SENTINEL-ACCESS-2", "SENTINEL-REFRESH-2"];

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return /\.ts$/.test(name) && !/\.test\.ts$/.test(name) ? [full] : [];
  });
}

const QBO_SOURCES = [
  ...sourceFiles("src/app/api/v1/integrations/qbo"),
  ...["qbo-connection.ts", "qbo-connector.ts", "oauth-state.ts"].map((f) => `src/lib/integrations/${f}`),
];

const TOKEN_WORD = /(access|refresh)_?token|\bdata\.\w*token/i;
const SINK = /console\.\w+|new Error\(|lastError|logger\./;

describe("no plaintext token reaches a log, error or audit sink (static)", () => {
  it("scans the QBO sources", () => {
    expect(QBO_SOURCES.length).toBeGreaterThanOrEqual(7);
  });

  it.each(QBO_SOURCES)("%s never passes a token variable to a log or error sink", (file) => {
    const offending = readFileSync(file, "utf8")
      .split("\n")
      .map((text, i) => ({ text, line: i + 1 }))
      .filter(({ text }) => SINK.test(text) && TOKEN_WORD.test(text) && !/^\s*\/\//.test(text));
    expect(offending).toEqual([]);
  });
});

describe("no plaintext token reaches a log, audit row or event (runtime)", () => {
  const logged: unknown[][] = [];

  beforeEach(async () => {
    process.env.QBO_CLIENT_ID = "cid";
    process.env.QBO_CLIENT_SECRET = "csec";
    logged.length = 0;
    for (const method of ["log", "info", "warn", "error", "debug"] as const) {
      vi.spyOn(console, method).mockImplementation((...args) => void logged.push(args));
    }
    await truncateAll();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.QBO_CLIENT_ID;
    delete process.env.QBO_CLIENT_SECRET;
  });

  it("connect, refresh, 401 revoke and disconnect leave no sentinel anywhere readable", async () => {
    const s = await seedOrg();
    await db.insert(users).values({ name: "Admin Ada", email: `ada-${crypto.randomUUID()}@example.test`, role: "ADMIN" });
    await upsertQboConnection({
      realmId: "r",
      accessToken: SENTINELS[0],
      refreshToken: SENTINELS[1],
      accessExpiresIn: 30,
      userId: s.requester.id,
    });
    const refreshed = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ access_token: SENTINELS[2], refresh_token: SENTINELS[3], expires_in: 3600 }),
        { status: 200 },
      ),
    );
    await getValidAccessToken(refreshed as unknown as typeof fetch);

    const rejected = vi.fn().mockResolvedValue(new Response("{}", { status: 401 }));
    const [event] = await db
      .insert(integrationEvents)
      .values({
        eventType: "PO_CREATED",
        payload: {
          purchaseOrderId: crypto.randomUUID(),
          supplier: "Acme",
          costCenter: "IT",
          currency: "EUR",
          issuedOn: "2026-08-24",
          totalMinor: 100,
          lines: [{ description: "x", quantity: 1, unitPriceMinor: 100 }],
        },
      })
      .returning();
    await createQboConnector({ fetchImpl: rejected as unknown as typeof fetch }).deliver({
      id: event.id,
      type: "PO_CREATED",
      payload: event.payload,
    });
    await markRevoked("manual").catch(() => undefined);
    await revokeConnection();

    const [conn] = await db.select().from(integrationsConnections);
    const readable = JSON.stringify({
      logged,
      audit: await db.select().from(auditEvents),
      events: await db.select().from(integrationEvents),
      lastError: conn.lastError,
    });
    for (const sentinel of SENTINELS) expect(readable).not.toContain(sentinel);
    expect(JSON.stringify(logged)).not.toMatch(/Bearer\s+\S{6,}/);
  });
});
