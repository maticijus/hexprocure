import { NextResponse } from "next/server";
import { errorToResponse, getActor } from "@/lib/api/helpers";
import { getLicense, getLicenseStatus } from "@/lib/license";
import { DomainError } from "@/lib/services/p2p";

export async function GET(request: Request) {
  try {
    const actor = await getActor(request);
    if (actor.role !== "ADMIN") {
      throw new DomainError("FORBIDDEN", "Requires ADMIN role");
    }
    return NextResponse.json({ ...getLicense(), status: getLicenseStatus() });
  } catch (error) {
    return errorToResponse(error);
  }
}
