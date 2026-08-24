import { NextResponse } from "next/server";
import { sendPurchaseOrder } from "@/lib/services/po-document";
import { errorToResponse, getActor } from "@/lib/api/helpers";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const actor = await getActor(request);
    const { id } = await params;
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
