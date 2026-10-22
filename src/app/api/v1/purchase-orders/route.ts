import { NextResponse } from "next/server";
import { listPurchaseOrders, parseListQuery } from "@/lib/services/reads";
import { errorToResponse, getActor } from "@/lib/api/helpers";

export async function GET(request: Request) {
  try {
    await getActor(request);
    const query = parseListQuery(request.url, "purchase_order");
    const items = await listPurchaseOrders(query);
    return NextResponse.json({ purchaseOrders: items, limit: query.limit, offset: query.offset });
  } catch (error) {
    return errorToResponse(error);
  }
}
