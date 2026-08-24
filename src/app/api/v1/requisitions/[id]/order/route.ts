import { NextResponse } from "next/server";
import { createPurchaseOrder } from "@/lib/services/p2p";
import { errorToResponse, getActor } from "@/lib/api/helpers";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const actor = await getActor(request);
    const { id } = await params;
    return NextResponse.json(await createPurchaseOrder(id, actor.id), { status: 201 });
  } catch (error) {
    return errorToResponse(error);
  }
}
