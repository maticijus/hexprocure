import { and, asc, eq, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { budgets } from "@/lib/db/schema";
import { BodyReader, definedOnly } from "@/lib/api/validate";
import { audit, DomainError, pgErrorCode } from "@/lib/services/p2p/shared";
import { getCostCenter } from "./cost-centers";

export type Budget = typeof budgets.$inferSelect;
export interface BudgetInput {
  costCenterId: string;
  yearMonth: string;
  budgetedMinor: number;
  currency: string;
}

export function parseBudgetInput(body: unknown): BudgetInput {
  const reader = new BodyReader(body);
  const input = {
    costCenterId: reader.uuid("costCenterId"),
    yearMonth: reader.yearMonth("yearMonth"),
    budgetedMinor: reader.nonNegativeInt("budgetedMinor"),
    currency: reader.currency("currency"),
  };
  reader.done();
  return input as BudgetInput;
}

/** Cost center, month and currency are fixed once reservations may exist;
 *  only the amount is editable. */
export function parseBudgetPatch(body: unknown): { budgetedMinor?: number } {
  const reader = new BodyReader(body, true);
  const patch = definedOnly({ budgetedMinor: reader.nonNegativeInt("budgetedMinor") });
  reader.done();
  return patch;
}

export async function listBudgets(opts: { includeArchived?: boolean } = {}) {
  return db
    .select()
    .from(budgets)
    .where(opts.includeArchived ? undefined : isNull(budgets.archivedAt))
    .orderBy(asc(budgets.yearMonth), asc(budgets.costCenterId));
}

export async function getBudget(id: string): Promise<Budget> {
  const [row] = await db.select().from(budgets).where(eq(budgets.id, id));
  if (!row) throw new DomainError("NOT_FOUND", "Budget not found");
  return row;
}

const DUPLICATE = "A budget for this cost center and month already exists";

/** An archived budget for the same cost center and month is restored with the
 *  new amount, since the unique index still covers it. */
export async function createBudget(input: BudgetInput, actorUserId: string): Promise<Budget> {
  const costCenter = await getCostCenter(input.costCenterId).catch(() => null);
  if (!costCenter || costCenter.archivedAt) {
    throw new DomainError("VALIDATION", "costCenterId must be an active cost center");
  }
  try {
    return await db.transaction(async (tx) => {
      const [existing] = await tx
        .select()
        .from(budgets)
        .where(and(eq(budgets.costCenterId, input.costCenterId), eq(budgets.yearMonth, input.yearMonth)));
      if (existing && !existing.archivedAt) throw new DomainError("INVALID_STATE", DUPLICATE);
      const [row] = existing
        ? await tx
            .update(budgets)
            .set({ budgetedMinor: input.budgetedMinor, currency: input.currency, archivedAt: null })
            .where(eq(budgets.id, existing.id))
            .returning()
        : await tx.insert(budgets).values(input).returning();
      await audit(tx, "budget", row.id, existing ? "RESTORED" : "CREATED", actorUserId);
      return row;
    });
  } catch (error) {
    if (pgErrorCode(error) === "23505") throw new DomainError("INVALID_STATE", DUPLICATE);
    throw error;
  }
}

export async function updateBudget(
  id: string,
  patch: { budgetedMinor?: number },
  actorUserId: string,
): Promise<Budget> {
  const current = await getBudget(id);
  if (current.archivedAt) throw new DomainError("INVALID_STATE", "Archived budgets cannot be edited");
  if (Object.keys(patch).length === 0) return current;
  return db.transaction(async (tx) => {
    const [row] = await tx.update(budgets).set(patch).where(eq(budgets.id, id)).returning();
    await audit(tx, "budget", id, "UPDATED", actorUserId, { fields: Object.keys(patch) });
    return row;
  });
}

export async function archiveBudget(id: string, actorUserId: string): Promise<Budget> {
  const current = await getBudget(id);
  if (current.archivedAt) return current;
  return db.transaction(async (tx) => {
    const [row] = await tx.update(budgets).set({ archivedAt: new Date() }).where(eq(budgets.id, id)).returning();
    await audit(tx, "budget", id, "ARCHIVED", actorUserId);
    return row;
  });
}
