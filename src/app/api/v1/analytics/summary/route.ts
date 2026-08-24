import { NextResponse } from "next/server";
import { analyticsSummary } from "@/lib/services/analytics";
import { DomainError } from "@/lib/services/p2p";
import { errorToResponse, getActor } from "@/lib/api/helpers";

export async function GET(request: Request) {
  try {
    const actor = await getActor(request);
    if (actor.role !== "FINANCE" && actor.role !== "ADMIN") {
      throw new DomainError("FORBIDDEN", "Requires FINANCE or ADMIN role");
    }
    return NextResponse.json(await analyticsSummary());
  } catch (error) {
    return errorToResponse(error);
  }
}
