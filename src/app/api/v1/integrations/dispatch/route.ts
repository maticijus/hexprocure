import { NextResponse } from "next/server";
import { dispatchPendingEvents } from "@/lib/integrations/dispatch";
import { registerConfiguredConnectors } from "@/lib/integrations/registry";
import { DomainError } from "@/lib/services/p2p";
import { errorToResponse, getActor } from "@/lib/api/helpers";

export async function POST(request: Request) {
  try {
    const actor = await getActor(request);
    if (actor.role !== "ADMIN" && actor.role !== "FINANCE") {
      throw new DomainError("FORBIDDEN", "Requires ADMIN or FINANCE role");
    }
    registerConfiguredConnectors();
    const result = await dispatchPendingEvents();
    return NextResponse.json(result);
  } catch (error) {
    return errorToResponse(error);
  }
}
