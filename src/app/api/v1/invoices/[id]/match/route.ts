import { NextResponse } from "next/server";
import { matchInvoiceById } from "@/lib/services/p2p";
import { errorToResponse, getActor } from "@/lib/api/helpers";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const actor = await getActor(request);
    const { id } = await params;
    return NextResponse.json(await matchInvoiceById(id, actor.id));
  } catch (error) {
    return errorToResponse(error);
  }
}
