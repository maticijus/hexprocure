import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { integrationsConnections } from "@/lib/db/schema";
import { seedOrg, truncateAll } from "@/lib/testing/seed";
import { DomainError } from "@/lib/services/p2p";
import { decryptSecret, loadKeySetFromEnv } from "@/lib/security/token-crypto";
import { getValidAccessToken, upsertQboConnection } from "@/lib/integrations/qbo-connection";

const actor = vi.hoisted(() => ({ role: "ADMIN" as string | null }));

vi.mock("@/lib/api/helpers", async (orig) => ({
  ...(await orig<typeof import("@/lib/api/helpers")>()),
  getActor: vi.fn(async () => {
    if (!actor.role) throw new DomainError("FORBIDDEN", "Authentication required");
    return { id: "u1", role: actor.role };
  }),
}));

import { POST } from "./route";

const call = () => POST(new Request("http://localhost/api/v1/integrations/qbo/disconnect", { method: "POST" }));

beforeEach(async () => {
  actor.role = "ADMIN";
  await truncateAll();
  const s = await seedOrg();
  await upsertQboConnection({
    realmId: "r",
    accessToken: "LIVE-ACCESS-SECRET",
    refreshToken: "LIVE-REFRESH-SECRET",
    accessExpiresIn: 3600,
    userId: s.requester.id,
  });
});

describe("POST /api/v1/integrations/qbo/disconnect", () => {
  it("wipes both stored tokens in the same request", async () => {
    const [before] = await db.select().from(integrationsConnections);
    const res = await call();
    expect(res.status).toBe(200);

    const [after] = await db.select().from(integrationsConnections);
    const keys = loadKeySetFromEnv();
    expect(after.status).toBe("REVOKED");
    expect(after.accessTokenEnc).not.toBe(before.accessTokenEnc);
    expect(after.refreshTokenEnc).not.toBe(before.refreshTokenEnc);
    expect(decryptSecret(after.accessTokenEnc, keys).plain).not.toContain("LIVE");
    expect(decryptSecret(after.refreshTokenEnc, keys).plain).not.toContain("LIVE");
    await expect(getValidAccessToken()).rejects.toThrow(/No active/);
  });

  it("rejects non-admin callers and leaves the tokens untouched", async () => {
    actor.role = "FINANCE";
    const [before] = await db.select().from(integrationsConnections);
    expect((await call()).status).toBe(403);
    const [after] = await db.select().from(integrationsConnections);
    expect(after.status).toBe("ACTIVE");
    expect(after.accessTokenEnc).toBe(before.accessTokenEnc);
  });
});
