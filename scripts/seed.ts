import "dotenv/config";
import { hashPassword } from "../src/lib/auth";
import { db, pool } from "../src/lib/db";
import {
  users, suppliers, costCenters, budgets, approvalRules,
  requisitions, requisitionLines, approvals,
  purchaseOrders, poLines, invoices, invoiceLines,
} from "../src/lib/db/schema";
import { eq } from "drizzle-orm";

async function main() {
  const existing = await db.select().from(users).where(eq(users.email, "admin@hexprocure.dev"));
  if (existing.length > 0) {
    console.log("Seed data already present — skipping");
    return;
  }

  const pw = hashPassword("password123");
  const [rita] = await db.insert(users).values({ name: "Rita Requester", email: "rita@hexprocure.dev", passwordHash: pw }).returning();
  const [max] = await db.insert(users).values({ name: "Max Manager", email: "max@hexprocure.dev", role: "MANAGER", passwordHash: pw }).returning();
  const [fiona] = await db.insert(users).values({ name: "Fiona Finance", email: "fiona@hexprocure.dev", role: "FINANCE", passwordHash: pw }).returning();
  const [admin] = await db.insert(users).values({ name: "Ada Admin", email: "admin@hexprocure.dev", role: "ADMIN", passwordHash: pw }).returning();

  const [acme] = await db.insert(suppliers).values({ name: "Acme Office GmbH", email: "orders@acme.de" }).returning();
  const [tech] = await db.insert(suppliers).values({ name: "TechSupply AG", email: "sales@techsupply.ch" }).returning();
  const [it] = await db.insert(costCenters).values({ name: "IT" }).returning();
  await db.insert(costCenters).values({ name: "Facilities" });
  const month = new Date().toISOString().slice(0, 7);
  await db.insert(budgets).values({ costCenterId: it.id, yearMonth: month, budgetedMinor: 5_000_000 });

  await db.insert(approvalRules).values([
    { sequence: 1, minMinor: 0, maxMinor: 50_000, approverRole: "MANAGER" },
    { sequence: 2, minMinor: 50_000, maxMinor: null, approverRole: "FINANCE" },
  ]);

  const [req1] = await db.insert(requisitions).values({
    requesterId: rita.id, supplierId: tech.id, costCenterId: it.id, status: "SUBMITTED",
  }).returning();
  await db.insert(requisitionLines).values({ requisitionId: req1.id, description: 'MacBook Pro 14"', quantity: 3, unitPriceMinor: 239_900 });
  await db.insert(approvals).values({ requisitionId: req1.id, approverRole: "FINANCE", sequence: 0 });

  const [req2] = await db.insert(requisitions).values({
    requesterId: rita.id, supplierId: acme.id, costCenterId: it.id, status: "APPROVED",
  }).returning();
  await db.insert(requisitionLines).values({ requisitionId: req2.id, description: "Standing desk", quantity: 4, unitPriceMinor: 44_900 });
  await db.insert(approvals).values({ requisitionId: req2.id, approverRole: "MANAGER", sequence: 0, decision: "APPROVE", decidedByUserId: max.id, decidedAt: new Date() });

  const [po] = await db.insert(purchaseOrders).values({
    requisitionId: req2.id, supplierId: acme.id, costCenterId: it.id,
  }).returning();
  await db.insert(poLines).values({ purchaseOrderId: po.id, description: "Standing desk", quantityOrdered: 4, unitPriceMinor: 44_900 });

  const [inv] = await db.insert(invoices).values({
    supplierId: acme.id, purchaseOrderId: po.id, number: "ACME-2026-001",
  }).returning();
  await db.insert(invoiceLines).values({ invoiceId: inv.id, poLineId: (await db.select().from(poLines).where(eq(poLines.purchaseOrderId, po.id)))[0].id, quantity: 4, unitPriceMinor: 44_900 });

  console.log("Seeded. Logins (password123):");
  console.log("  rita@hexprocure.dev / max@hexprocure.dev / fiona@hexprocure.dev / admin@hexprocure.dev");
}

main()
  .then(() => pool.end())
  .catch((e) => { console.error(e); pool.end(); process.exit(1); });
