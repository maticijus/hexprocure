import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { poLines } from "@/lib/db/schema";
import { errorToResponse, getActor } from "@/lib/api/helpers";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await getActor(request);
    const { id } = await params;
    const rows = await db.select().from(poLines).where(eq(poLines.purchaseOrderId, id));
    return NextResponse.json({
      lines: rows.map((l) => ({
        id: l.id,
        description: l.description,
        kind: l.kind,
        quantityOrdered: l.quantityOrdered,
        unitPriceMinor: l.unitPriceMinor,
      })),
    });
  } catch (error) {
    return errorToResponse(error);
  }
}
