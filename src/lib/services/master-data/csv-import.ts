import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { costCenters, suppliers } from "@/lib/db/schema";
import { parseCsv } from "@/lib/csv";
import { BodyReader } from "@/lib/api/validate";
import { audit, DomainError, type Tx } from "@/lib/services/p2p/shared";
import { nameConflict as supplierConflict } from "./suppliers";
import { nameConflict as costCenterConflict } from "./cost-centers";

export const MAX_IMPORT_BYTES = 1024 * 1024;
export const MAX_IMPORT_ROWS = 2000;

export interface ImportResult {
  created: number;
  updated: number;
  skipped: number;
  errors: { row: number; message: string }[];
}

/** Checks size, header and row count; returns data rows as objects keyed by
 *  the header. Row numbers in errors count the header as row 1. */
function readRows(text: string, columns: readonly string[]): Record<string, string>[] {
  if (Buffer.byteLength(text, "utf8") > MAX_IMPORT_BYTES) {
    throw new DomainError("VALIDATION", "CSV must be at most 1 MB");
  }
  const [header, ...rows] = parseCsv(text);
  const names = (header ?? []).map((h) => h.trim().toLowerCase());
  if (!names.includes("name") || names.some((n) => !columns.includes(n))) {
    throw new DomainError("VALIDATION", `CSV header must be: ${columns.join(",")}`);
  }
  if (rows.length > MAX_IMPORT_ROWS) {
    throw new DomainError("VALIDATION", `CSV may have at most ${MAX_IMPORT_ROWS} rows`);
  }
  return rows.map((cells) => Object.fromEntries(names.map((n, i) => [n, cells[i] ?? ""])));
}

type Table = typeof suppliers | typeof costCenters;

async function activeByName(tx: Tx, table: Table, name: string) {
  return tx
    .select({ id: table.id })
    .from(table)
    .where(and(sql`lower(${table.name}) = lower(${name})`, isNull(table.archivedAt)));
}

async function importRows(
  text: string,
  columns: readonly string[],
  apply: (tx: Tx, row: Record<string, string>) => Promise<"created" | "updated" | "skipped">,
): Promise<ImportResult> {
  const rows = readRows(text, columns);
  const result: ImportResult = { created: 0, updated: 0, skipped: 0, errors: [] };
  await db.transaction(async (tx) => {
    for (const [i, row] of rows.entries()) {
      try {
        result[await apply(tx, row)]++;
      } catch (error) {
        if (!(error instanceof DomainError)) throw error;
        result.errors.push({ row: i + 2, message: error.message });
      }
    }
  });
  return result;
}

/** Upserts suppliers by name (case-insensitive, active rows only). */
export async function importSuppliers(text: string, actorUserId: string): Promise<ImportResult> {
  return importRows(text, ["name", "email"], async (tx, row) => {
    const reader = new BodyReader(row);
    const name = reader.string("name");
    const email = reader.email("email");
    reader.done();
    const matches = await activeByName(tx, suppliers, name!);
    if (matches.length > 1) throw new DomainError("VALIDATION", `More than one supplier is named "${name}"`);
    if (matches.length === 0) {
      try {
        // savepoint: a lost race must not abort the whole import transaction
        await tx.transaction(async (sp) => {
          const [created] = await sp.insert(suppliers).values({ name: name!, email: email ?? null }).returning();
          await audit(sp, "supplier", created.id, "CREATED", actorUserId, { source: "csv" });
        });
      } catch (error) {
        throw supplierConflict(error, name!);
      }
      return "created";
    }
    const [current] = await tx.select().from(suppliers).where(eq(suppliers.id, matches[0].id));
    if (!("email" in row) || (current.email ?? null) === (email ?? null)) return "skipped";
    await tx.update(suppliers).set({ email: email ?? null }).where(eq(suppliers.id, current.id));
    await audit(tx, "supplier", current.id, "UPDATED", actorUserId, { source: "csv", fields: ["email"] });
    return "updated";
  });
}

/** Creates cost centers whose name is new; existing names are skipped. */
export async function importCostCenters(text: string, actorUserId: string): Promise<ImportResult> {
  return importRows(text, ["name"], async (tx, row) => {
    const reader = new BodyReader(row);
    const name = reader.string("name");
    reader.done();
    const matches = await activeByName(tx, costCenters, name!);
    if (matches.length > 0) return "skipped";
    try {
      await tx.transaction(async (sp) => {
        const [created] = await sp.insert(costCenters).values({ name: name! }).returning();
        await audit(sp, "cost_center", created.id, "CREATED", actorUserId, { source: "csv" });
      });
    } catch (error) {
      throw costCenterConflict(error, name!);
    }
    return "created";
  });
}
