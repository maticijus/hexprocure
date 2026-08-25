import { test, expect } from "@playwright/test";
import { login, apiPost, dbQuery } from "./helpers";

let supplierId: string;

test.beforeAll(async ({ browser }) => {
  const page = await browser.newPage();
  await login(page, "rita@hexprocure.dev");
  const options = await page
    .request
    .get("/api/v1/meta/options")
    .then((r) => r.json());
  supplierId = options.suppliers.find((s: { name: string }) => s.name === "Acme Office GmbH").id;
  await page.close();
});

test("rita requests → max approves → order → receive → fiona matches & approves invoice", async ({ browser }) => {
  test.setTimeout(120_000);

  // — rita creates and submits a requisition through the UI —
  const rita = await browser.newPage();
  await login(rita, "rita@hexprocure.dev");
  await rita.goto("/requisitions/new");
  await rita.getByLabel("Supplier").selectOption({ label: "Acme Office GmbH" });
  await rita.getByLabel("Cost Center").selectOption({ label: "IT" });
  await rita.getByLabel("Description").fill("Laser printer");
  await rita.getByLabel("Quantity", { exact: true }).fill("2");
  await rita.getByLabel("Unit Price (€)").fill("150.00");
  await rita.getByRole("button", { name: "Create Requisition" }).click();
  await rita.waitForURL("**/requisitions");

  const draftRow = rita.locator("tr", { hasText: "Acme Office GmbH" }).first();
  await expect(draftRow).toContainText("DRAFT");
  await expect(async () => {
    await draftRow.getByRole("button", { name: "Submit" }).click();
    await expect(draftRow).toContainText("SUBMITTED");
  }).toPass({ timeout: 15_000 });
  const requisitionId = (await dbQuery<{ id: string }>(
    "SELECT id FROM requisitions ORDER BY created_at DESC LIMIT 1",
  )).rows[0].id;
  await rita.close();

  // — max approves in his inbox through the UI —
  const max = await browser.newPage();
  await login(max, "max@hexprocure.dev");
  await max.goto("/approvals");
  const pendingRow = max.locator("tr", { hasText: "Acme Office GmbH" }).first();
  await expect(pendingRow).toBeVisible();
  await expect(async () => {
    await pendingRow.getByRole("button", { name: "Approve" }).click();
    await expect(max.getByText("Nothing pending")).toBeVisible();
  }).toPass({ timeout: 15_000 });
  await max.close();

  // — order + receive via the API surface —
  const worker = await browser.newPage();
  await login(worker, "rita@hexprocure.dev");
  const orderRes = await apiPost(worker, `/api/v1/requisitions/${requisitionId}/order`);
  expect(orderRes.status()).toBe(201);
  const { purchaseOrderId } = await orderRes.json();

  const poLine = (await dbQuery<{ id: string }>(
    "SELECT id FROM po_lines WHERE purchase_order_id = $1",
    [purchaseOrderId],
  )).rows[0];

  const receiptRes = await apiPost(worker, `/api/v1/purchase-orders/${purchaseOrderId}/receipts`, {
    lines: [{ poLineId: poLine.id, quantityReceived: 2 }],
  });
  expect(receiptRes.status()).toBe(201);
  await worker.close();

  // PO shows CLOSED after full receipt
  const viewer = await browser.newPage();
  await login(viewer, "fiona@hexprocure.dev");
  await viewer.goto("/purchase-orders");
  await expect(
    viewer.locator("tr", { hasText: "Acme Office GmbH" }).first(),
  ).toContainText("CLOSED");

  // — fiona books the invoice, matches it, approves it —
  const invoiceRes = await apiPost(viewer, "/api/v1/invoices", {
    supplierId,
    purchaseOrderId,
    number: `E2E-${Date.now()}`,
    lines: [{ poLineId: poLine.id, quantity: 2, unitPriceMinor: 15_000 }],
  });
  expect(invoiceRes.status()).toBe(201);
  const invoiceId = (await invoiceRes.json()).id as string;

  const matchRes = await apiPost(viewer, `/api/v1/invoices/${invoiceId}/match`);
  expect(matchRes.ok()).toBeTruthy();
  expect((await matchRes.json()).status).toBe("MATCHED");

  const approveRes = await apiPost(viewer, `/api/v1/invoices/${invoiceId}/approve`);
  expect(approveRes.ok()).toBeTruthy();

  await viewer.goto("/invoices");
  await expect(
    viewer.locator("tr", { hasText: "Acme Office GmbH" }).first(),
  ).toContainText("APPROVED");
  await viewer.close();
});

test("approval inbox reject action removes the task", async ({ browser }) => {
  const page = await browser.newPage();
  await login(page, "rita@hexprocure.dev");
  await page.goto("/requisitions/new");
  await page.getByLabel("Supplier").selectOption({ label: "Acme Office GmbH" });
  await page.getByLabel("Cost Center").selectOption({ label: "IT" });
  await page.getByLabel("Description").fill("Rejected goods");
  await page.getByLabel("Quantity", { exact: true }).fill("1");
  await page.getByLabel("Unit Price (€)").fill("10.00");
  await page.getByRole("button", { name: "Create Requisition" }).click();
  await page.waitForURL("**/requisitions");
  const row = page.locator("tr", { hasText: "€10,00" }).first();
  await expect(row).toContainText("DRAFT");
  await expect(async () => {
    await row.getByRole("button", { name: "Submit" }).click();
    await expect(row).toContainText("SUBMITTED");
  }).toPass({ timeout: 15_000 });
  await page.close();

  const manager = await browser.newPage();
  await login(manager, "max@hexprocure.dev");
  await manager.goto("/approvals");
  const pending = manager.locator("tr", { hasText: "€10,00" }).first();
  await expect(pending).toBeVisible();
  await expect(async () => {
    await pending.getByRole("button", { name: "Reject" }).click();
    await expect(manager.getByText("Nothing pending")).toBeVisible();
  }).toPass({ timeout: 15_000 });
  await manager.close();
});
