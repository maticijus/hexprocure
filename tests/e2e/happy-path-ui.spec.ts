import { test, expect, type Page } from "@playwright/test";
import { login, dbQuery } from "./helpers";

const stamp = Date.now();
const INVOICE_NO = `UI-${stamp}`;

async function createRequisition(page: Page) {
  await page.goto("/requisitions/new");
  await page.getByLabel("Supplier").selectOption({ label: "Acme Office GmbH" });
  await page.getByLabel("Cost Center").selectOption({ label: "IT" });
  await page.getByLabel("Description").first().fill("Monitor");
  await page.getByLabel("Quantity", { exact: true }).first().fill("2");
  await page.getByLabel(/Unit Price/).first().fill("100.00");
  await page.getByRole("button", { name: "Add line" }).click();
  await page.getByLabel("Description").nth(1).fill("Keyboard");
  await page.getByLabel("Quantity", { exact: true }).nth(1).fill("3");
  await page.getByLabel(/Unit Price/).nth(1).fill("20.00");
  await expect(page.getByTestId("requisition-total")).toContainText("260.00");
  await page.getByRole("button", { name: "Create Requisition" }).click();
  await page.waitForURL("**/requisitions");
}

test("clickable happy path: request, approve, order, receive, invoice, match, approve", async ({ browser }) => {
  test.setTimeout(180_000);

  const rita = await browser.newPage();
  await login(rita, "rita@hexprocure.dev");
  await createRequisition(rita);
  await rita.locator("tr", { hasText: "Acme Office GmbH" }).first().getByRole("link", { name: "Acme Office GmbH" }).click();
  await rita.waitForURL(/\/requisitions\/[0-9a-f-]{36}$/);
  const requisitionId = rita.url().split("/").pop()!;
  await expect(rita.getByRole("heading", { name: "Monitor" })).toHaveCount(0);
  await expect(rita.getByRole("cell", { name: "Monitor" })).toBeVisible();
  await expect(rita.getByRole("cell", { name: "Keyboard" })).toBeVisible();
  await rita.getByRole("button", { name: "Submit" }).click();
  await expect(rita.getByTestId("status")).toHaveText("SUBMITTED");
  await rita.close();

  const max = await browser.newPage();
  await login(max, "max@hexprocure.dev");
  await max.goto(`/requisitions/${requisitionId}`);
  await max.getByRole("button", { name: "Approve" }).click();
  await expect(max.getByTestId("status")).toHaveText("APPROVED");
  await max.getByRole("button", { name: "Create purchase order" }).click();
  await max.waitForURL(/\/purchase-orders\/[0-9a-f-]{36}$/);
  const poId = max.url().split("/").pop()!;
  await max.getByLabel(/Receive .*Monitor/).fill("2");
  await max.getByLabel(/Receive .*Keyboard/).fill("3");
  await max.getByRole("button", { name: "Record receipt" }).click();
  await expect(max.getByTestId("status")).toHaveText("CLOSED");
  await max.close();

  const fiona = await browser.newPage();
  await login(fiona, "fiona@hexprocure.dev");
  await fiona.goto("/invoices/new");
  await fiona.getByLabel("Purchase order").selectOption(poId);
  await fiona.getByLabel("Invoice number").fill(INVOICE_NO);
  await fiona.getByRole("button", { name: "Save invoice" }).click();
  await fiona.waitForURL(/\/invoices\/[0-9a-f-]{36}$/);
  await fiona.getByRole("button", { name: "Match" }).click();
  await expect(fiona.getByTestId("status")).toHaveText("MATCHED");
  await fiona.getByRole("button", { name: "Approve invoice" }).click();
  await expect(fiona.getByTestId("status")).toHaveText("APPROVED");
  await fiona.close();

  const row = await dbQuery<{ status: string }>("SELECT status FROM invoices WHERE number = $1", [INVOICE_NO]);
  expect(row.rows[0].status).toBe("APPROVED");
});
