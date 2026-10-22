import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { errorToResponse, getActor } from "@/lib/api/helpers";
import { revokeUserSessions } from "@/lib/services/sessions";
import { DomainError } from "@/lib/services/p2p";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const actor = await getActor(request);
    if (actor.role !== "ADMIN") {
      return NextResponse.json(
        { error: { code: "FORBIDDEN", message: "Requires ADMIN role" } },
        { status: 403 },
      );
    }
    const { id } = await params;
    if (!UUID_RE.test(id)) throw new DomainError("VALIDATION", "Invalid user id");
    const [user] = await db.select({ id: users.id }).from(users).where(eq(users.id, id));
    if (!user) throw new DomainError("NOT_FOUND", "User not found");
    const revoked = await revokeUserSessions(id, actor.id);
    return NextResponse.json({ ok: true, revoked });
  } catch (error) {
    return errorToResponse(error);
  }
}
