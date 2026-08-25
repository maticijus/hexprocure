import { NextResponse } from "next/server";
import { addReceipt } from "@/lib/services/p2p";
import { errorToResponse, getActor, readJson } from "@/lib/api/helpers";

interface ReceiptBody {
  lines?: { poLineId?: string; quantityReceived?: number; accepted?: boolean }[];
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const actor = await getActor(request);
    const body = await readJson<ReceiptBody>(request);
    if (!Array.isArray(body.lines) || body.lines.length === 0) {
      return NextResponse.json(
        { error: { code: "VALIDATION", message: "at least one receipt line is required" } },
        { status: 400 },
      );
    }
    for (const [i, line] of body.lines.entries()) {
      if (typeof line.poLineId !== "string" || !line.poLineId) {
        return NextResponse.json(
          { error: { code: "VALIDATION", message: `line ${i}: poLineId is required` } },
          { status: 400 },
        );
      }
      if (
        !Number.isInteger(line.quantityReceived) ||
        (line.quantityReceived as number) < 0
      ) {
        return NextResponse.json(
          { error: { code: "VALIDATION", message: `line ${i}: quantityReceived must be a non-negative integer` } },
          { status: 400 },
        );
      }
    }
    const { id } = await params;
    const result = await addReceipt(id, body.lines as { poLineId: string; quantityReceived: number; accepted?: boolean }[], actor.id);
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    return errorToResponse(error);
  }
}
