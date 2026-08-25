import "../scripts/e2e-env";
import { hashPassword } from "../src/lib/auth";
import { db, pool } from "../src/lib/db";
import {
  users, suppliers, costCenters, budgets, approvalRules,
} from "../src/lib/db/schema";
import { truncateAll } from "../src/lib/testing/seed";

async function main() {
  await truncateAll();

  const pw = hashPassword("password123");
  await db.insert(users).values({ name: "Rita Requester", email: "rita@hexprocure.dev", passwordHash: pw });
  await db.insert(users).values({ name: "Max Manager", email: "max@hexprocure.dev", role: "MANAGER", passwordHash: pw });
  await db.insert(users).values({ name: "Fiona Finance", email: "fiona@hexprocure.dev", role: "FINANCE", passwordHash: pw });
  await db.insert(users).values({ name: "Ada Admin", email: "admin@hexprocure.dev", role: "ADMIN", passwordHash: pw });

  const [acme] = await db.insert(suppliers).values({ name: "Acme Office GmbH", email: "orders@acme.de" }).returning();
  const [it] = await db.insert(costCenters).values({ name: "IT" }).returning();
  const month = new Date().toISOString().slice(0, 7);
  await db.insert(budgets).values({ costCenterId: it.id, yearMonth: month, budgetedMinor: 10_000_000 });
  await db.insert(approvalRules).values([
    { sequence: 1, minMinor: 0, maxMinor: 50_000, approverRole: "MANAGER" },
    { sequence: 2, minMinor: 50_000, maxMinor: null, approverRole: "FINANCE" },
  ]);

  console.log(`E2E seed complete (supplier ${acme.name})`);
}

main()
  .then(() => pool.end())
  .catch((e) => { console.error(e); pool.end(); process.exit(1); });
