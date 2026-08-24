import { and, eq, lte, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  auditEvents,
  orderTemplateLines,
  orderTemplates,
  requisitionLines,
  requisitions,
  users,
} from "@/lib/db/schema";
import { DomainError } from "./p2p";
import { addMonthsIso, cadenceStepMonths, type Cadence } from "./recurring-cadence";

export interface CreateOrderTemplateInput {
  name: string;
  requesterId: string;
  supplierId: string;
  costCenterId: string;
  cadence: Cadence;
  nextRunDate?: string;
  active?: boolean;
  lines: { description: string; quantity: number; unitPriceMinor: number; kind?: "GOODS" | "SERVICE" }[];
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function createOrderTemplate(input: CreateOrderTemplateInput) {
  if (!input.name?.trim()) throw new DomainError("VALIDATION", "name is required");
  const nextRunDate = input.nextRunDate ?? new Date().toISOString().slice(0, 10);
  if (!ISO_DATE_RE.test(nextRunDate)) {
    throw new DomainError("VALIDATION", "nextRunDate must be YYYY-MM-DD");
  }
  if (input.lines.length === 0) {
    throw new DomainError("VALIDATION", "at least one line is required");
  }

  return db.transaction(async (tx) => {
    const [requester] = await tx.select().from(users).where(eq(users.id, input.requesterId));
    if (!requester) throw new DomainError("NOT_FOUND", "Requester not found");

    const [template] = await tx
      .insert(orderTemplates)
      .values({
        name: input.name.trim(),
        requesterId: input.requesterId,
        supplierId: input.supplierId,
        costCenterId: input.costCenterId,
        cadence: input.cadence,
        nextRunDate,
        ...(input.active === false ? { active: false } : {}),
      })
      .returning();

    await tx.insert(orderTemplateLines).values(
      input.lines.map((l) => ({
        templateId: template.id,
        description: l.description,
        quantity: l.quantity,
        unitPriceMinor: l.unitPriceMinor,
        kind: l.kind ?? "GOODS",
      })),
    );

    await tx.insert(auditEvents).values({
      entityType: "order_template",
      entityId: template.id,
      action: "CREATED",
      actorUserId: input.requesterId,
    });

    return template;
  });
}

export interface GenerationResult {
  created: number;
}

/** Generates DRAFT requisitions for all due active templates and advances their
 *  next_run_date by one cadence step. Row-level locks prevent double generation
 *  under concurrent dispatch. */
export async function generateDueRequisitions(
  today: string,
  actorUserId: string,
): Promise<GenerationResult> {
  return db.transaction(async (tx) => {
    const due = await tx
      .select()
      .from(orderTemplates)
      .where(and(eq(orderTemplates.active, true), lte(orderTemplates.nextRunDate, today)));

    let created = 0;
    for (const template of due) {
      // serialize concurrent dispatchers per template
      await tx.execute(sql`SELECT id FROM order_templates WHERE id = ${template.id} FOR UPDATE`);

      const lines = await tx
        .select()
        .from(orderTemplateLines)
        .where(eq(orderTemplateLines.templateId, template.id));
      if (lines.length === 0) continue;

      const [requisition] = await tx
        .insert(requisitions)
        .values({
          requesterId: template.requesterId,
          supplierId: template.supplierId,
          costCenterId: template.costCenterId,
          currency: "EUR",
        })
        .returning();

      await tx.insert(requisitionLines).values(
        lines.map((l) => ({
          requisitionId: requisition.id,
          description: l.description,
          quantity: l.quantity,
          unitPriceMinor: l.unitPriceMinor,
          kind: l.kind,
        })),
      );

      const nextDate = addMonthsIso(template.nextRunDate, cadenceStepMonths(template.cadence as Cadence));
      await tx
        .update(orderTemplates)
        .set({ nextRunDate: nextDate })
        .where(eq(orderTemplates.id, template.id));

      await tx.insert(auditEvents).values({
        entityType: "order_template",
        entityId: template.id,
        action: "ORDER_GENERATED",
        actorUserId,
        payload: { requisitionId: requisition.id },
      });
      created++;
    }
    return { created };
  });
}
