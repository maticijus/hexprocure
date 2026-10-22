import { and, asc, eq, isNull, ne, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { costCenters } from "@/lib/db/schema";
import { BodyReader, definedOnly } from "@/lib/api/validate";
import { audit, DomainError, pgErrorCode } from "@/lib/services/p2p/shared";

export type CostCenter = typeof costCenters.$inferSelect;
export interface CostCenterInput {
  name: string;
}

export function parseCostCenterInput(body: unknown, partial = false): Partial<CostCenterInput> {
  const reader = new BodyReader(body, partial);
  const input = definedOnly({ name: reader.string("name") });
  reader.done();
  return input;
}

export async function listCostCenters(opts: { includeArchived?: boolean } = {}) {
  return db
    .select()
    .from(costCenters)
    .where(opts.includeArchived ? undefined : isNull(costCenters.archivedAt))
    .orderBy(asc(costCenters.name));
}

export async function getCostCenter(id: string): Promise<CostCenter> {
  const [row] = await db.select().from(costCenters).where(eq(costCenters.id, id));
  if (!row) throw new DomainError("NOT_FOUND", "Cost center not found");
  return row;
}

/** Active cost centers with this name, ignoring case. */
export async function findActiveCostCentersByName(name: string, exceptId?: string) {
  return db
    .select()
    .from(costCenters)
    .where(
      and(
        sql`lower(${costCenters.name}) = lower(${name})`,
        isNull(costCenters.archivedAt),
        exceptId ? ne(costCenters.id, exceptId) : undefined,
      ),
    );
}

async function assertNameFree(name: string, exceptId?: string) {
  if ((await findActiveCostCentersByName(name, exceptId)).length > 0) {
    throw new DomainError("INVALID_STATE", `A cost center named "${name}" already exists`);
  }
}

export async function createCostCenter(input: CostCenterInput, actorUserId: string): Promise<CostCenter> {
  await assertNameFree(input.name);
  try {
    return await db.transaction(async (tx) => {
      const [row] = await tx.insert(costCenters).values(input).returning();
      await audit(tx, "cost_center", row.id, "CREATED", actorUserId);
      return row;
    });
  } catch (error) {
    throw nameConflict(error, input.name);
  }
}

/** The partial unique index backs assertNameFree when two writers race. */
export function nameConflict(error: unknown, name: string): unknown {
  return pgErrorCode(error) === "23505"
    ? new DomainError("INVALID_STATE", `A cost center named "${name}" already exists`)
    : error;
}

export async function updateCostCenter(
  id: string,
  patch: Partial<CostCenterInput>,
  actorUserId: string,
): Promise<CostCenter> {
  const current = await getCostCenter(id);
  if (current.archivedAt) throw new DomainError("INVALID_STATE", "Archived cost centers cannot be edited");
  if (Object.keys(patch).length === 0) return current;
  if (patch.name) await assertNameFree(patch.name, id);
  try {
    return await db.transaction(async (tx) => {
      const [row] = await tx.update(costCenters).set(patch).where(eq(costCenters.id, id)).returning();
      await audit(tx, "cost_center", id, "UPDATED", actorUserId, { fields: Object.keys(patch) });
      return row;
    });
  } catch (error) {
    throw nameConflict(error, patch.name ?? current.name);
  }
}

export async function archiveCostCenter(id: string, actorUserId: string): Promise<CostCenter> {
  const current = await getCostCenter(id);
  if (current.archivedAt) return current;
  return db.transaction(async (tx) => {
    const [row] = await tx
      .update(costCenters)
      .set({ archivedAt: new Date() })
      .where(eq(costCenters.id, id))
      .returning();
    await audit(tx, "cost_center", id, "ARCHIVED", actorUserId);
    return row;
  });
}
