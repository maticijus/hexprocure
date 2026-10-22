import { NextResponse } from "next/server";
import { assertUuid, getInvoice } from "@/lib/services/reads";
import { errorToResponse, getActor } from "@/lib/api/helpers";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await getActor(request);
    const { id } = await params;
    assertUuid(id);
    return NextResponse.json(await getInvoice(id));
  } catch (error) {
    return errorToResponse(error);
  }
}
