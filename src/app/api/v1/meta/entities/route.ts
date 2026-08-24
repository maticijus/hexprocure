import { NextResponse } from "next/server";
import { desc } from "drizzle-orm";
import { db } from "@/lib/db";
import { requisitions, purchaseOrders, invoices } from "@/lib/db/schema";
import { errorToResponse, getActor } from "@/lib/api/helpers";

/** Lightweight id+label lists for the attachment picker. */
export async function GET(request: Request) {
  try {
    await getActor(request);
    const type = new URL(request.url).searchParams.get("type");
    if (type === "requisition") {
      const rows = await db.select().from(requisitions).orderBy(desc(requisitions.createdAt)).limit(50);
      return NextResponse.json({
        entities: rows.map((r) => ({ id: r.id, label: `Requisition ${r.id.slice(0, 8)} (${r.status})` })),
      });
    }
    if (type === "purchase_order") {
      const rows = await db.select().from(purchaseOrders).orderBy(desc(purchaseOrders.createdAt)).limit(50);
      return NextResponse.json({
        entities: rows.map((r) => ({ id: r.id, label: `PO ${r.id.slice(0, 8)} (${r.status})` })),
      });
    }
    if (type === "invoice") {
      const rows = await db.select().from(invoices).orderBy(desc(invoices.createdAt)).limit(50);
      return NextResponse.json({
        entities: rows.map((r) => ({ id: r.id, label: `Invoice ${r.number}` })),
      });
    }
    return NextResponse.json({ error: { code: "VALIDATION", message: "?type= required" } }, { status: 400 });
  } catch (error) {
    return errorToResponse(error);
  }
}
