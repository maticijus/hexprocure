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

export async function truncateAll() {
  for (const table of [
    "integration_events",
    "audit_events",
    "invoice_lines",
    "invoices",
    "receipt_lines",
    "receipts",
    "po_lines",
    "purchase_orders",
    "budget_reservations",
    "approvals",
    "requisition_lines",
    "requisitions",
    "approval_rules",
    "budgets",
    "cost_centers",
    "suppliers",
    "users",
  ]) {
    await db.execute(sql.raw(`TRUNCATE ${table} CASCADE`));
  }
}

const uniqueEmail = (prefix: string) => `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@hex.test`;

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
  const [supplier] = await db.insert(suppliers).values({ name: "Acme GmbH", email: "orders@acme.test" }).returning();
  const [cc] = await db.insert(costCenters).values({ name: "IT" }).returning();
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
