import { desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { integrationsConnections } from "@/lib/db/schema";
import {
  decryptSecret,
  encryptSecret,
  loadKeySetFromEnv,
} from "@/lib/security/token-crypto";

const REFRESH_WINDOW_SECONDS = 5 * 60;
const REFRESH_TOKEN_LIFETIME_DAYS = 100;
const TOKEN_URL = "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer";

export interface StoredConnection {
  id: string;
  provider: string;
  realmId: string;
  status: "ACTIVE" | "EXPIRED" | "REVOKED" | "ERROR";
}

async function requireKeys() {
  try {
    return loadKeySetFromEnv();
  } catch (error) {
    throw new Error(
      `Cannot store OAuth tokens: ${(error as Error).message} (generate with: openssl rand -base64 32)`,
    );
  }
}

export async function upsertQboConnection(input: {
  realmId: string;
  accessToken: string;
  refreshToken: string;
  accessExpiresIn: number;
  /** Intuit's redirect carries no session; recorded when initiated server-side. */
  userId?: string;
}): Promise<StoredConnection> {
  const keys = await requireKeys();
  const now = Date.now();
  const values = {
    provider: "qbo",
    realmId: input.realmId,
    accessTokenEnc: encryptSecret(input.accessToken, keys),
    refreshTokenEnc: encryptSecret(input.refreshToken, keys),
    accessExpiresAt: new Date(now + input.accessExpiresIn * 1000),
    refreshExpiresAt: new Date(now + REFRESH_TOKEN_LIFETIME_DAYS * 24 * 3600 * 1000),
    status: "ACTIVE" as const,
    lastError: null,
    connectedByUserId: input.userId ?? null,
    updatedAt: new Date(),
  };

  const [existing] = await db
    .select()
    .from(integrationsConnections)
    .where(eq(integrationsConnections.provider, "qbo"));
  if (existing) {
    const [row] = await db
      .update(integrationsConnections)
      .set(values)
      .where(eq(integrationsConnections.id, existing.id))
      .returning();
    return row;
  }
  const [row] = await db.insert(integrationsConnections).values(values).returning();
  return row;
}

interface TokenRow {
  id: string;
  realmId: string;
  accessTokenEnc: string;
  refreshTokenEnc: string;
  accessExpiresAt: Date;
  refreshExpiresAt: Date;
  status: "ACTIVE" | "EXPIRED" | "REVOKED" | "ERROR";
  lastError: string | null;
}

async function loadActiveConnection(): Promise<TokenRow | null> {
  const [row] = await db
    .select()
    .from(integrationsConnections)
    .where(eq(integrationsConnections.provider, "qbo"))
    .orderBy(desc(integrationsConnections.createdAt))
    .limit(1);
  return row ?? null;
}

function secondsUntil(date: Date): number {
  return Math.floor((date.getTime() - Date.now()) / 1000);
}

export async function getValidAccessToken(
  fetchImpl: typeof fetch = fetch,
): Promise<{ accessToken: string; realmId: string }> {
  const row = await loadActiveConnection();
  if (!row || row.status !== "ACTIVE") {
    throw new Error("No active QBO connection — an admin must reconnect");
  }

  if (secondsUntil(row.refreshExpiresAt) <= 0) {
    throw new Error("QBO connection requires re-authentication (refresh token expired)");
  }

  const keys = loadKeySetFromEnv();
  let accessToken = decryptSecret(row.accessTokenEnc, keys).plain;

  if (secondsUntil(row.accessExpiresAt) <= REFRESH_WINDOW_SECONDS) {
    const refreshToken = decryptSecret(row.refreshTokenEnc, keys).plain;

    if (!process.env.QBO_CLIENT_ID || !process.env.QBO_CLIENT_SECRET) {
      throw new Error("QBO_CLIENT_ID / QBO_CLIENT_SECRET are not configured");
    }
    const basic = Buffer.from(
      `${process.env.QBO_CLIENT_ID}:${process.env.QBO_CLIENT_SECRET}`,
    ).toString("base64");
    const res = await fetchImpl(TOKEN_URL, {
      method: "POST",
      headers: {
        authorization: `Basic ${basic}`,
        "content-type": "application/x-www-form-urlencoded",
        accept: "application/json",
      },
      body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: refreshToken }),
    });
    if (!res.ok) {
      await db
        .update(integrationsConnections)
        .set({ status: "EXPIRED", lastError: `Refresh failed: HTTP ${res.status}`, updatedAt: new Date() })
        .where(eq(integrationsConnections.id, row.id));
      throw new Error("QBO connection expired — admin re-authentication required");
    }
    const data = (await res.json()) as {
      access_token: string;
      refresh_token?: string;
      expires_in: number;
    };
    accessToken = data.access_token;
    await db
      .update(integrationsConnections)
      .set({
        accessTokenEnc: encryptSecret(data.access_token, keys),
        ...(data.refresh_token ? { refreshTokenEnc: encryptSecret(data.refresh_token, keys) } : {}),
        accessExpiresAt: new Date(Date.now() + data.expires_in * 1000),
        updatedAt: new Date(),
      })
      .where(eq(integrationsConnections.id, row.id));
  }

  return { accessToken, realmId: row.realmId };
}

export async function markRevoked(lastError: string): Promise<void> {
  await db
    .update(integrationsConnections)
    .set({ status: "REVOKED", lastError, updatedAt: new Date() })
    .where(eq(integrationsConnections.provider, "qbo"));
}

export async function revokeConnection(): Promise<void> {
  const keys = loadKeySetFromEnv();
  const wipe = encryptSecret("revoked", keys);
  await db
    .update(integrationsConnections)
    .set({
      status: "REVOKED",
      accessTokenEnc: wipe,
      refreshTokenEnc: wipe,
      updatedAt: new Date(),
    })
    .where(eq(integrationsConnections.provider, "qbo"));
}

export async function hasHealthyQboConnection(): Promise<boolean> {
  const row = await loadActiveConnection();
  return !!row && row.status === "ACTIVE";
}
