import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { auditEvents, requisitionLines, requisitions } from "@/lib/db/schema";
import { errorToResponse, getActor, readJson } from "@/lib/api/helpers";

async function audit(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  entityType: string,
  entityId: string,
  action: string,
  actorUserId?: string | null,
  payload?: Record<string, unknown>,
) {
  await tx.insert(auditEvents).values({
    entityType,
    entityId,
    action,
    actorUserId: actorUserId ?? null,
    payload,
  });
}

interface CreateRequisitionBody {
  supplierId?: string;
  costCenterId?: string;
  currency?: string;
  lines?: { description?: string; quantity?: number; unitPriceMinor?: number; kind?: string }[];
}

export async function POST(request: Request) {
  try {
    const actor = await getActor(request);
    const body = await readJson<CreateRequisitionBody>(request);

    const errors: string[] = [];
    if (!body.supplierId) errors.push("supplierId is required");
    if (!body.costCenterId) errors.push("costCenterId is required");
    const lines = body.lines ?? [];
    if (lines.length === 0) errors.push("at least one line is required");
    for (const [i, line] of lines.entries()) {
      if (!line.description?.trim()) errors.push(`line ${i}: description required`);
      if (!Number.isInteger(line.quantity) || line.quantity! <= 0)
        errors.push(`line ${i}: quantity must be a positive integer`);
      if (!Number.isInteger(line.unitPriceMinor) || line.unitPriceMinor! < 0)
        errors.push(`line ${i}: unitPriceMinor must be a non-negative integer`);
    }
    if (errors.length > 0) {
      return NextResponse.json(
        { error: { code: "VALIDATION", message: errors.join("; ") } },
        { status: 400 },
      );
    }

    const result = await db.transaction(async (tx) => {
      const [req] = await tx
        .insert(requisitions)
        .values({
          requesterId: actor.id,
          supplierId: body.supplierId!,
          costCenterId: body.costCenterId!,
          currency: body.currency ?? "EUR",
        })
        .returning();
      await tx.insert(requisitionLines).values(
        lines.map((l) => ({
          requisitionId: req.id,
          description: l.description!.trim(),
          quantity: l.quantity!,
          unitPriceMinor: l.unitPriceMinor!,
          kind: l.kind === "SERVICE" ? ("SERVICE" as const) : ("GOODS" as const),
        })),
      );
      await audit(tx, "requisition", req.id, "CREATED", actor.id, {
        lineCount: lines.length,
      });
      return req;
    });

    return NextResponse.json({ id: result.id, status: result.status }, { status: 201 });
  } catch (error) {
    return errorToResponse(error);
  }
}
