// Usage: BASE_URL=http://localhost:3120 npx tsx scripts/screenshots.ts
// Needs a running production build against a seeded database (scripts/seed.ts).
import { chromium, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";

const BASE = process.env.BASE_URL ?? "http://localhost:3120";
const OUT = "docs/screenshots";

async function shot(page: Page, name: string) {
  await page.waitForLoadState("networkidle");
  await page.screenshot({ path: `${OUT}/${name}.png` });
  console.log("saved", name);
}

async function openFirst(page: Page, list: string, name: string) {
  await page.goto(`${BASE}${list}`);
  await page.locator(`tbody a[href^="${list}/"]`).first().click();
  await page.waitForURL(new RegExp(`${list}/[^/]+$`));
  await shot(page, name);
}

async function fillRequisition(page: Page) {
  await page.goto(`${BASE}/requisitions/new`);
  const selects = page.locator("select");
  await selects.nth(0).selectOption({ index: 1 });
  await selects.nth(1).selectOption({ index: 1 });
  await page.getByRole("button", { name: "Add line" }).click();
  const desc = ["Standing desks, oak, 140 cm", "Ergonomic office chairs"];
  const price = ["420.00", "185.50"];
  for (let i = 0; i < 2; i++) {
    const f = page.locator("fieldset").nth(i);
    await f.getByPlaceholder("What are you buying?").fill(desc[i]);
    await f.locator('input[type="number"]').first().fill(i === 0 ? "6" : "12");
    await f.getByPlaceholder("0.00").fill(price[i]);
  }
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  await page.goto(`${BASE}/login`);
  await page.getByPlaceholder("you@company.com").fill("fiona@hexprocure.dev");
  await page.getByPlaceholder("••••••••").fill("password123");
  await page.locator('button[type="submit"]').click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"));

  for (const [path, name] of [
    ["/dashboard", "dashboard"],
    ["/requisitions", "requisitions"],
  ] as const) {
    await page.goto(`${BASE}${path}`);
    await shot(page, name);
  }
  await openFirst(page, "/requisitions", "requisition-detail");
  await fillRequisition(page);
  await shot(page, "requisition-new");
  await page.goto(`${BASE}/approvals`);
  await shot(page, "approvals");
  await openFirst(page, "/purchase-orders", "purchase-order-detail");
  await page.goto(`${BASE}/invoices`);
  await shot(page, "invoices");
  await openFirst(page, "/invoices", "invoice-detail");
  await page.goto(`${BASE}/invoices/new`);
  await shot(page, "invoice-new");
  await page.goto(`${BASE}/analytics`);
  await shot(page, "analytics");
  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
