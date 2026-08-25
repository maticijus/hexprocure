import { test, expect } from "@playwright/test";
import { login, dbQuery } from "./helpers";

test("recurring template create + run now generates a draft requisition", async ({ page }) => {
  await login(page, "admin@hexprocure.dev");
  await page.goto("/recurring");

  const options = await page.request.get("/api/v1/meta/options").then((r) => r.json());
  const supplierId = options.suppliers.find((s: { name: string }) => s.name === "Acme Office GmbH").id;
  const costCenterId = options.costCenters.find((c: { name: string }) => c.name === "IT").id;

  const templateName = `E2E coffee ${Date.now()}`;
  await page.getByLabel("Name").fill(templateName);
  await page.getByLabel("Supplier").selectOption(supplierId);
  await page.getByLabel("Cost center").selectOption(costCenterId);
  await page.getByLabel("Line description").fill("Coffee beans");
  await page.getByLabel("Quantity").fill("4");
  await page.getByLabel("Unit price (€)").fill("24.90");

  const before = (await dbQuery<{ count: string }>("SELECT COUNT(*) AS count FROM requisitions"))
    .rows[0].count;

  await page.getByRole("button", { name: "Create template" }).click();
  await expect(page.getByText("Template created ✓")).toBeVisible();
  await expect(
    page.locator("div", { hasText: templateName }).filter({ hasText: "monthly" }).first(),
  ).toBeVisible();

  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "Run due templates now" }).click();
  await expect(page.getByText(/Generated \d+ draft requisition/)).toBeVisible({ timeout: 15_000 });

  const after = (await dbQuery<{ count: string }>("SELECT COUNT(*) AS count FROM requisitions"))
    .rows[0].count;
  expect(Number(after)).toBeGreaterThan(Number(before));
});
