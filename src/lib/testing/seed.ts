import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  users,
  suppliers,
  costCenters,
  budgets,
  approvalRules,
  requisitions,
  requisitionLines,
} from "@/lib/db/schema";

/** Leaf-to-root order so FKs never block; must cover EVERY table in the
 *  schema or tests leak state across runs (see seed.test.ts guard). */
export const TRUNCATE_TABLES = [
  "llm_usage",
  "integration_events",
  "qbo_sync_map",
  "integrations_connections",
  "audit_events",
  "attachments",
  "api_tokens",
  "sessions",
  "invoice_lines",
  "invoices",
  "receipt_lines",
  "receipts",
  "po_lines",
  "purchase_orders",
  "order_template_lines",
  "order_templates",
  "budget_reservations",
  "approvals",
  "requisition_lines",
  "requisitions",
  "approval_rules",
  "budgets",
  "cost_centers",
  "suppliers",
  "users",
];

export async function truncateAll() {
  for (const table of TRUNCATE_TABLES) {
    await db.execute(sql.raw(`TRUNCATE ${table} CASCADE`));
  }
}

const uniqueEmail = (prefix: string) => `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@hex.test`;

/** Active names are unique, so a second seedOrg call without truncation gets a numbered name. */
async function freeName(table: typeof suppliers | typeof costCenters, base: string): Promise<string> {
  const [{ n }] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(table)
    .where(sql`lower(${table.name}) like lower(${base}) || '%'`);
  return n === 0 ? base : `${base} ${n + 1}`;
}

export async function seedOrg() {
  const [requester] = await db
    .insert(users)
    .values({ name: "Requester Rita", email: uniqueEmail("rita") })
    .returning();
  const [manager] = await db
    .insert(users)
    .values({ name: "Manager Max", email: uniqueEmail("max"), role: "MANAGER" })
    .returning();
  const [finance] = await db
    .insert(users)
    .values({ name: "Finance Fiona", email: uniqueEmail("fiona"), role: "FINANCE" })
    .returning();
  const [supplier] = await db
    .insert(suppliers)
    .values({ name: await freeName(suppliers, "Acme GmbH"), email: "orders@acme.test" })
    .returning();
  const [cc] = await db.insert(costCenters).values({ name: await freeName(costCenters, "IT") }).returning();
  const yearMonth = new Date().toISOString().slice(0, 7);
  const [budget] = await db
    .insert(budgets)
    .values({ costCenterId: cc.id, yearMonth, budgetedMinor: 1_000_000 })
    .returning();
  const rules = await db
    .insert(approvalRules)
    .values([
      { sequence: 1, minMinor: 0, maxMinor: 50_000, approverRole: "MANAGER", currency: "EUR" },
      { sequence: 2, minMinor: 50_000, maxMinor: null, approverRole: "FINANCE", currency: "EUR" },
    ])
    .returning();
  return { requester, manager, finance, supplier, cc, yearMonth, budget, rules };
}

export async function createRequisitionWithLine(
  requesterId: string,
  supplierId: string,
  costCenterId: string,
  qty: number,
  unitPriceMinor: number,
) {
  const [req] = await db
    .insert(requisitions)
    .values({ requesterId, supplierId, costCenterId, currency: "EUR" })
    .returning();
  await db.insert(requisitionLines).values({
    requisitionId: req.id,
    description: "Test items",
    quantity: qty,
    unitPriceMinor,
  });
  return req;
}
