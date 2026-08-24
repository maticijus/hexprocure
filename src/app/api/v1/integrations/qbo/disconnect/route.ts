import { NextResponse } from "next/server";
import { revokeConnection } from "@/lib/integrations/qbo-connection";
import { DomainError } from "@/lib/services/p2p";
import { errorToResponse, getActor } from "@/lib/api/helpers";

export async function POST(request: Request) {
  try {
    const actor = await getActor(request);
    if (actor.role !== "ADMIN") throw new DomainError("FORBIDDEN", "Requires ADMIN role");
    await revokeConnection();
    return NextResponse.json({ ok: true });
  } catch (error) {
    return errorToResponse(error);
  }
}
