import { NextResponse } from "next/server";
import { asc } from "drizzle-orm";
import { db } from "@/lib/db";
import { suppliers, costCenters } from "@/lib/db/schema";
import { errorToResponse, getActor } from "@/lib/api/helpers";

export async function GET(request: Request) {
  try {
    await getActor(request);
    const [supplierRows, ccRows] = await Promise.all([
      db.select().from(suppliers).orderBy(asc(suppliers.name)),
      db.select().from(costCenters).orderBy(asc(costCenters.name)),
    ]);
    return NextResponse.json({
      suppliers: supplierRows.map((s) => ({ id: s.id, name: s.name })),
      costCenters: ccRows.map((c) => ({ id: c.id, name: c.name })),
    });
  } catch (error) {
    return errorToResponse(error);
  }
}
