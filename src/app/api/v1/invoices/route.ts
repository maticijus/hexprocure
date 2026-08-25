import { NextResponse } from "next/server";
import { createInvoice } from "@/lib/services/p2p";
import { errorToResponse, getActor, readJson } from "@/lib/api/helpers";

interface CreateInvoiceBody {
  supplierId?: string;
  purchaseOrderId?: string;
  number?: string;
  lines?: {
    poLineId?: string;
    quantity?: number;
    unitPriceMinor?: number;
    amountMinor?: number;
  }[];
}

export async function POST(request: Request) {
  try {
    const actor = await getActor(request);
    const body = await readJson<CreateInvoiceBody>(request);
    if (!body.supplierId || !body.purchaseOrderId || !body.number?.trim()) {
      return NextResponse.json(
        { error: { code: "VALIDATION", message: "supplierId, purchaseOrderId and number are required" } },
        { status: 400 },
      );
    }
    if (!Array.isArray(body.lines) || body.lines.length === 0) {
      return NextResponse.json(
        { error: { code: "VALIDATION", message: "at least one invoice line is required" } },
        { status: 400 },
      );
    }
    const invoice = await createInvoice(
      {
        supplierId: body.supplierId,
        purchaseOrderId: body.purchaseOrderId,
        number: body.number,
        lines: body.lines,
      },
      actor.id,
    );
    return NextResponse.json(
      { id: invoice.id, status: invoice.status, number: invoice.number },
      { status: 201 },
    );
  } catch (error) {
    return errorToResponse(error);
  }
}
