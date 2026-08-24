import { NextResponse } from "next/server";
import { generateDueRequisitions } from "@/lib/services/recurring";
import { DomainError } from "@/lib/services/p2p";
import { errorToResponse, getActor } from "@/lib/api/helpers";

/** Cron entry point: generates DRAFT requisitions for all due templates. */
export async function POST(request: Request) {
  try {
    const actor = await getActor(request);
    if (actor.role !== "ADMIN" && actor.role !== "FINANCE") {
      throw new DomainError("FORBIDDEN", "Requires ADMIN or FINANCE role");
    }
    const today = new Date().toISOString().slice(0, 10);
    return NextResponse.json(await generateDueRequisitions(today, actor.id));
  } catch (error) {
    return errorToResponse(error);
  }
}
