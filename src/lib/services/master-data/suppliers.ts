import { and, asc, eq, isNull, ne, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { suppliers } from "@/lib/db/schema";
import { BodyReader, definedOnly } from "@/lib/api/validate";
import { audit, DomainError, pgErrorCode } from "@/lib/services/p2p/shared";

export type Supplier = typeof suppliers.$inferSelect;
export interface SupplierInput {
  name: string;
  email: string | null;
}

export function parseSupplierInput(body: unknown, partial = false): Partial<SupplierInput> {
  const reader = new BodyReader(body, partial);
  const input = definedOnly({ name: reader.string("name"), email: reader.email("email") });
  reader.done();
  return input;
}

export async function listSuppliers(opts: { includeArchived?: boolean } = {}) {
  return db
    .select()
    .from(suppliers)
    .where(opts.includeArchived ? undefined : isNull(suppliers.archivedAt))
    .orderBy(asc(suppliers.name));
}

export async function getSupplier(id: string): Promise<Supplier> {
  const [row] = await db.select().from(suppliers).where(eq(suppliers.id, id));
  if (!row) throw new DomainError("NOT_FOUND", "Supplier not found");
  return row;
}

/** Active suppliers with this name, ignoring case. */
export async function findActiveSuppliersByName(name: string, exceptId?: string) {
  return db
    .select()
    .from(suppliers)
    .where(
      and(
        sql`lower(${suppliers.name}) = lower(${name})`,
        isNull(suppliers.archivedAt),
        exceptId ? ne(suppliers.id, exceptId) : undefined,
      ),
    );
}

async function assertNameFree(name: string, exceptId?: string) {
  if ((await findActiveSuppliersByName(name, exceptId)).length > 0) {
    throw new DomainError("INVALID_STATE", `A supplier named "${name}" already exists`);
  }
}

export async function createSupplier(input: SupplierInput, actorUserId: string): Promise<Supplier> {
  await assertNameFree(input.name);
  try {
    return await db.transaction(async (tx) => {
      const [row] = await tx.insert(suppliers).values(input).returning();
      await audit(tx, "supplier", row.id, "CREATED", actorUserId);
      return row;
    });
  } catch (error) {
    throw nameConflict(error, input.name);
  }
}

/** The partial unique index backs assertNameFree when two writers race. */
export function nameConflict(error: unknown, name: string): unknown {
  return pgErrorCode(error) === "23505"
    ? new DomainError("INVALID_STATE", `A supplier named "${name}" already exists`)
    : error;
}

export async function updateSupplier(
  id: string,
  patch: Partial<SupplierInput>,
  actorUserId: string,
): Promise<Supplier> {
  const current = await getSupplier(id);
  if (current.archivedAt) throw new DomainError("INVALID_STATE", "Archived suppliers cannot be edited");
  if (Object.keys(patch).length === 0) return current;
  if (patch.name) await assertNameFree(patch.name, id);
  try {
    return await db.transaction(async (tx) => {
      const [row] = await tx.update(suppliers).set(patch).where(eq(suppliers.id, id)).returning();
      await audit(tx, "supplier", id, "UPDATED", actorUserId, { fields: Object.keys(patch) });
      return row;
    });
  } catch (error) {
    throw nameConflict(error, patch.name ?? current.name);
  }
}

export async function archiveSupplier(id: string, actorUserId: string): Promise<Supplier> {
  const current = await getSupplier(id);
  if (current.archivedAt) return current;
  return db.transaction(async (tx) => {
    const [row] = await tx
      .update(suppliers)
      .set({ archivedAt: new Date() })
      .where(eq(suppliers.id, id))
      .returning();
    await audit(tx, "supplier", id, "ARCHIVED", actorUserId);
    return row;
  });
}
