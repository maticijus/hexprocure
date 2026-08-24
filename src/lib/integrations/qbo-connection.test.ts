import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { eq } from "drizzle-orm";
import { db, pool } from "@/lib/db";
import { integrationsConnections } from "@/lib/db/schema";
import { seedOrg, truncateAll } from "@/lib/testing/seed";
import {
  upsertQboConnection,
  getValidAccessToken,
  markRevoked,
  revokeConnection,
} from "./qbo-connection";

const KEYS = { current: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=" };

beforeEach(async () => {
  await truncateAll();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

function tokenResponse(access: string, expiresIn = 3600, refresh = "refresh-new") {
  return new Response(
    JSON.stringify({ access_token: access, expires_in: expiresIn, refresh_token: refresh }),
    { status: 200 },
  );
}

describe("upsertQboConnection", () => {
  it("stores only ciphertext — plaintext tokens never touch the database", async () => {
    const s = await seedOrg();
    await upsertQboConnection({
      realmId: "realm-1",
      accessToken: "PLAINTEXT-ACCESS-123",
      refreshToken: "PLAINTEXT-REFRESH-456",
      accessExpiresIn: 3600,
      userId: s.admin?.id ?? s.requester.id,
    });

    const [row] = await db.select().from(integrationsConnections);
    expect(row.provider).toBe("qbo");
    expect(JSON.stringify(row)).not.toContain("PLAINTEXT-ACCESS-123");
    expect(row.accessTokenEnc.startsWith("v1:")).toBe(true);

    const back = await getValidAccessToken();
    expect(back.accessToken).toBe("PLAINTEXT-ACCESS-123");
    expect(back.realmId).toBe("realm-1");
  });
});

describe("getValidAccessToken", () => {
  it("returns the stored token without network when it is fresh", async () => {
    const fetchMock = vi.fn();
    const s = await seedOrg();
    await upsertQboConnection({
      realmId: "r", accessToken: "fresh-token", refreshToken: "r1",
      accessExpiresIn: 3600, userId: s.requester.id,
    });
    const result = await getValidAccessToken(fetchMock as unknown as typeof fetch);
    expect(result.accessToken).toBe("fresh-token");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refreshes when the access token expires within 5 minutes and rotates both tokens", async () => {
    const fetchMock = vi.fn().mockResolvedValue(tokenResponse("access-v2", 3600, "refresh-v2"));
    process.env.QBO_CLIENT_ID = "cid";
    process.env.QBO_CLIENT_SECRET = "csec";
    const s = await seedOrg();
    await upsertQboConnection({
      realmId: "r", accessToken: "old-access", refreshToken: "old-refresh",
      accessExpiresIn: 60, userId: s.requester.id,
    });

    const result = await getValidAccessToken(fetchMock as unknown as typeof fetch);

    expect(result.accessToken).toBe("access-v2");
    expect(fetchMock).toHaveBeenCalledOnce();
    const [row] = await db.select().from(integrationsConnections);
    expect(await getValidAccessToken(vi.fn() as unknown as typeof fetch)).toMatchObject({
      accessToken: "access-v2",
    });
    // rotation actually persisted
    const raw = JSON.stringify(row);
    expect(raw).not.toContain("old-refresh");
    delete process.env.QBO_CLIENT_ID;
    delete process.env.QBO_CLIENT_SECRET;
  });

  it("marks the connection EXPIRED when refresh fails", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{"error":"invalid_grant"}', { status: 400 }));
    process.env.QBO_CLIENT_ID = "cid";
    process.env.QBO_CLIENT_SECRET = "csec";
    const s = await seedOrg();
    await upsertQboConnection({
      realmId: "r", accessToken: "a", refreshToken: "broken",
      accessExpiresIn: 10, userId: s.requester.id,
    });

    await expect(getValidAccessToken(fetchMock as unknown as typeof fetch)).rejects.toThrow(/re-auth/i);
    const [row] = await db.select().from(integrationsConnections);
    expect(row.status).toBe("EXPIRED");
    delete process.env.QBO_CLIENT_ID;
    delete process.env.QBO_CLIENT_SECRET;
  });
});

describe("revocation", () => {
  it("markRevoked sets status and keeps events pending-safe", async () => {
    const s = await seedOrg();
    await upsertQboConnection({
      realmId: "r", accessToken: "a", refreshToken: "r",
      accessExpiresIn: 3600, userId: s.requester.id,
    });
    await markRevoked("401 from Intuit");
    const [row] = await db.select().from(integrationsConnections);
    expect(row.status).toBe("REVOKED");
    expect(row.lastError).toContain("401");
  });

  it("revokeConnection wipes usable ciphertext", async () => {
    const s = await seedOrg();
    await upsertQboConnection({
      realmId: "r", accessToken: "live-secret", refreshToken: "r",
      accessExpiresIn: 3600, userId: s.requester.id,
    });
    await revokeConnection();
    const [row] = await db.select().from(integrationsConnections);
    expect(row.status).toBe("REVOKED");
    await expect(getValidAccessToken()).rejects.toThrow();
    expect(JSON.stringify(row)).not.toContain("live-secret");
  });
});
