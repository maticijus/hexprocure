import { NextResponse } from "next/server";
import { sendPurchaseOrder } from "@/lib/services/po-document";
import { DomainError } from "@/lib/services/p2p";
import { isUuid } from "@/lib/ids";
import { errorToResponse, getActor } from "@/lib/api/helpers";

const SEND_ROLES = new Set(["MANAGER", "FINANCE", "ADMIN"]);

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const actor = await getActor(request);
    if (!SEND_ROLES.has(actor.role)) {
      throw new DomainError("FORBIDDEN", "Requires MANAGER, FINANCE or ADMIN role");
    }
    const { id } = await params;
    if (!isUuid(id)) throw new DomainError("NOT_FOUND", "PO not found");
    let to: string | undefined;
    try {
      const body = (await request.json()) as { to?: string };
      to = body?.to;
    } catch {
      to = undefined;
    }
    const result = await sendPurchaseOrder(id, actor.id, to);
    return NextResponse.json(result);
  } catch (error) {
    return errorToResponse(error);
  }
}
