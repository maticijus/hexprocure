import { NextResponse } from "next/server";
import { errorToResponse, getActor } from "@/lib/api/helpers";
import { getLicenseState } from "@/lib/license";
import { DomainError } from "@/lib/services/p2p";

export async function GET(request: Request) {
  try {
    const actor = await getActor(request);
    if (actor.role !== "ADMIN") {
      throw new DomainError("FORBIDDEN", "Requires ADMIN role");
    }
    const { license, status } = getLicenseState();
    return NextResponse.json({ ...license, status });
  } catch (error) {
    return errorToResponse(error);
  }
}
