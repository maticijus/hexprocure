import { NextResponse } from "next/server";
import { cancelPurchaseOrder, DomainError } from "@/lib/services/p2p";
import { isUuid } from "@/lib/ids";
import { errorToResponse, getActor } from "@/lib/api/helpers";

const CANCEL_ROLES = new Set(["MANAGER", "FINANCE", "ADMIN"]);

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const actor = await getActor(request);
    if (!CANCEL_ROLES.has(actor.role)) {
      throw new DomainError("FORBIDDEN", "Requires MANAGER, FINANCE or ADMIN role");
    }
    const { id } = await params;
    if (!isUuid(id)) throw new DomainError("NOT_FOUND", "PO not found");
    return NextResponse.json(await cancelPurchaseOrder(id, actor.id));
  } catch (error) {
    return errorToResponse(error);
  }
}
