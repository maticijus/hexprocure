import { NextResponse } from "next/server";
import { asc } from "drizzle-orm";
import { db } from "@/lib/db";
import { orderTemplates } from "@/lib/db/schema";
import { createOrderTemplate } from "@/lib/services/recurring";
import { errorToResponse, getActor, readJson } from "@/lib/api/helpers";

interface LineBody { description?: string; quantity?: number; unitPriceMinor?: number; kind?: string }

export async function GET(request: Request) {
  try {
    await getActor(request);
    const rows = await db.select().from(orderTemplates).orderBy(asc(orderTemplates.name));
    return NextResponse.json({ templates: rows });
  } catch (error) {
    return errorToResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const actor = await getActor(request);
    const body = await readJson<{
      name?: string;
      supplierId?: string;
      costCenterId?: string;
      cadence?: "MONTHLY" | "QUARTERLY" | "YEARLY";
      nextRunDate?: string;
      lines?: LineBody[];
    }>(request);

    if (!body.supplierId || !body.costCenterId || !body.cadence) {
      return NextResponse.json(
        { error: { code: "VALIDATION", message: "supplierId, costCenterId and cadence are required" } },
        { status: 400 },
      );
    }
    const lines = (body.lines ?? []).filter((l) => l.description?.trim());
    const template = await createOrderTemplate({
      name: body.name ?? body.lines?.[0]?.description ?? "Recurring order",
      requesterId: actor.id,
      supplierId: body.supplierId,
      costCenterId: body.costCenterId,
      cadence: body.cadence,
      nextRunDate: body.nextRunDate,
      lines: lines.map((l) => ({
        description: l.description!.trim(),
        quantity: l.quantity ?? 1,
        unitPriceMinor: l.unitPriceMinor ?? 0,
        kind: l.kind === "SERVICE" ? "SERVICE" : "GOODS",
      })),
    });
    return NextResponse.json({ id: template.id }, { status: 201 });
  } catch (error) {
    return errorToResponse(error);
  }
}
