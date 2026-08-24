import { createHash, randomBytes } from "node:crypto";
import { and, desc, eq, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { apiTokens, users } from "@/lib/db/schema";
import { DomainError } from "./p2p";

const TOKEN_PREFIX = "hxp_";

function hashToken(plaintext: string): string {
  return createHash("sha256").update(plaintext).digest("hex");
}

export async function createApiToken(input: { name: string; userId: string }) {
  if (!input.name?.trim()) {
    throw new DomainError("VALIDATION", "Token name is required");
  }
  const [user] = await db.select().from(users).where(eq(users.id, input.userId));
  if (!user) throw new DomainError("NOT_FOUND", "User not found");

  const plaintext = `${TOKEN_PREFIX}${randomBytes(32).toString("base64url")}`;
  const [row] = await db
    .insert(apiTokens)
    .values({ name: input.name.trim(), tokenHash: hashToken(plaintext), userId: input.userId })
    .returning();

  return { id: row.id, name: row.name, plaintext };
}

export async function verifyApiToken(
  plaintext: string,
): Promise<{ id: string; name: string; email: string; role: string } | null> {
  if (!plaintext.startsWith(TOKEN_PREFIX)) return null;
  const hash = hashToken(plaintext);

  const [row] = await db
    .select()
    .from(apiTokens)
    .where(and(eq(apiTokens.tokenHash, hash), isNull(apiTokens.revokedAt)));
  if (!row) return null;

  const [user] = await db.select().from(users).where(eq(users.id, row.userId));
  if (!user) return null;

  await db.update(apiTokens).set({ lastUsedAt: new Date() }).where(eq(apiTokens.id, row.id));

  return { id: user.id, name: user.name, email: user.email, role: user.role };
}

export async function listApiTokens(userId: string) {
  return db
    .select({
      id: apiTokens.id,
      name: apiTokens.name,
      createdAt: apiTokens.createdAt,
      lastUsedAt: apiTokens.lastUsedAt,
      revokedAt: apiTokens.revokedAt,
    })
    .from(apiTokens)
    .where(eq(apiTokens.userId, userId))
    .orderBy(desc(apiTokens.createdAt));
}

export async function revokeApiToken(tokenId: string): Promise<void> {
  await db
    .update(apiTokens)
    .set({ revokedAt: new Date() })
    .where(eq(apiTokens.id, tokenId));
}
