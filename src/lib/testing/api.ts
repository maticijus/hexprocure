import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { SESSION_COOKIE } from "@/lib/auth";
import { startSession } from "@/lib/services/sessions";

type Role = "REQUESTER" | "MANAGER" | "FINANCE" | "ADMIN";

/** A logged-in user of the given role, as a cookie header for route tests. */
export async function sessionCookie(role: Role): Promise<string> {
  const [user] = await db
    .insert(users)
    .values({ name: role, email: `${role.toLowerCase()}-${crypto.randomUUID()}@hex.test`, role })
    .returning();
  return `${SESSION_COOKIE}=${await startSession(user.id)}`;
}

export function apiRequest(cookie: string | null, method = "GET", body?: unknown, url = "http://x/api/v1/x") {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (cookie) headers.cookie = cookie;
  return new Request(url, {
    method,
    headers,
    body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
  });
}

export const idParams = (id: string) => ({ params: Promise.resolve({ id }) });
