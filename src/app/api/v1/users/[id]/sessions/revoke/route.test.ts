import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { db, pool } from "@/lib/db";
import { auditEvents, sessions, users } from "@/lib/db/schema";
import { SESSION_COOKIE } from "@/lib/auth";
import { getActor } from "@/lib/api/helpers";
import { startSession } from "@/lib/services/sessions";
import { truncateAll } from "@/lib/testing/seed";
import { POST } from "./route";

beforeEach(async () => {
  await truncateAll();
});

const cookie = (token: string) => ({ cookie: `${SESSION_COOKIE}=${token}` });
const call = (id: string, token: string) =>
  POST(new Request("http://x", { method: "POST", headers: cookie(token) }), {
    params: Promise.resolve({ id }),
  });

async function seed() {
  const [admin] = await db.insert(users).values({ name: "A", email: "a@hex.test", role: "ADMIN" }).returning();
  const [victim] = await db.insert(users).values({ name: "V", email: "v@hex.test" }).returning();
  const [other] = await db.insert(users).values({ name: "X", email: "x@hex.test" }).returning();
  return { admin, victim, other };
}

describe("POST /api/v1/users/[id]/sessions/revoke", () => {
  it("lets an admin revoke every live session of the victim only", async () => {
    const { admin, victim, other } = await seed();
    const v1 = await startSession(victim.id);
    const v2 = await startSession(victim.id);
    const o1 = await startSession(other.id);
    const adminToken = await startSession(admin.id);

    const res = await call(victim.id, adminToken);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, revoked: 2 });
    for (const t of [v1, v2]) {
      const req = new Request("http://x", { headers: cookie(t) });
      await expect(getActor(req)).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
    expect((await getActor(new Request("http://x", { headers: cookie(o1) }))).id).toBe(other.id);
    const events = await db.select().from(auditEvents).where(eq(auditEvents.action, "SESSIONS_REVOKED"));
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ entityType: "user", entityId: victim.id, actorUserId: admin.id });
  });

  it("returns 403 for a non-admin and revokes nothing", async () => {
    const { victim, other } = await seed();
    const v1 = await startSession(victim.id);
    const otherToken = await startSession(other.id);

    const res = await call(victim.id, otherToken);

    expect(res.status).toBe(403);
    expect((await getActor(new Request("http://x", { headers: cookie(v1) }))).id).toBe(victim.id);
    expect((await db.select().from(sessions).where(eq(sessions.userId, victim.id)))[0].revokedAt).toBeNull();
  });

  it("returns 403 without a session, 404 for an unknown user, 400 for a bad id", async () => {
    const { admin } = await seed();
    const adminToken = await startSession(admin.id);
    const anon = await POST(new Request("http://x", { method: "POST" }), {
      params: Promise.resolve({ id: admin.id }),
    });
    expect(anon.status).toBe(403);
    expect((await call(crypto.randomUUID(), adminToken)).status).toBe(404);
    expect((await call("not-a-uuid", adminToken)).status).toBe(400);
  });
});

afterAll(async () => {
  await pool.end();
});
