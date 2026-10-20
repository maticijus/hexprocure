import { cookies } from "next/headers";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { getAuthSecret } from "@/lib/auth-secret";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/auth";

export async function getCurrentUser() {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const payload = verifySessionToken(token, getAuthSecret());
  if (!payload) return null;
  const [user] = await db.select().from(users).where(eq(users.id, payload.userId));
  return user ?? null;
}
