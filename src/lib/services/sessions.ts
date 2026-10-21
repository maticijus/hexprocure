import { createHash } from "node:crypto";
import { and, eq, gt, inArray, isNull, lt } from "drizzle-orm";
import { db } from "@/lib/db";
import { sessions } from "@/lib/db/schema";
import { getAuthSecret } from "@/lib/auth-secret";
import { createSessionToken, SESSION_TTL_SECONDS } from "@/lib/auth";
import { audit } from "./p2p/shared";

const PURGE_AFTER_MS = 30 * 24 * 60 * 60 * 1000;
const PURGE_BATCH = 1000;

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function startSession(userId: string, userAgent?: string | null): Promise<string> {
  const token = createSessionToken(userId, getAuthSecret());
  await db.insert(sessions).values({
    userId,
    tokenHash: hashToken(token),
    expiresAt: new Date(Date.now() + SESSION_TTL_SECONDS * 1000),
    userAgent: userAgent ?? null,
  });
  return token;
}

export async function isSessionLive(token: string): Promise<boolean> {
  const [row] = await db
    .select({ id: sessions.id })
    .from(sessions)
    .where(
      and(
        eq(sessions.tokenHash, hashToken(token)),
        isNull(sessions.revokedAt),
        gt(sessions.expiresAt, new Date()),
      ),
    );
  return Boolean(row);
}

export async function revokeSession(token: string): Promise<void> {
  await db
    .update(sessions)
    .set({ revokedAt: new Date() })
    .where(and(eq(sessions.tokenHash, hashToken(token)), isNull(sessions.revokedAt)));
}

export async function revokeUserSessions(userId: string, actorUserId: string): Promise<number> {
  return db.transaction(async (tx) => {
    const revoked = await tx
      .update(sessions)
      .set({ revokedAt: new Date() })
      .where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt), gt(sessions.expiresAt, new Date())))
      .returning({ id: sessions.id });
    await audit(tx, "user", userId, "SESSIONS_REVOKED", actorUserId, { count: revoked.length });
    return revoked.length;
  });
}

export async function purgeExpiredSessions(): Promise<void> {
  const stale = db
    .select({ id: sessions.id })
    .from(sessions)
    .where(lt(sessions.expiresAt, new Date(Date.now() - PURGE_AFTER_MS)))
    .limit(PURGE_BATCH);
  await db.delete(sessions).where(inArray(sessions.id, stale));
}
