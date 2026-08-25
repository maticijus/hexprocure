import { test, expect } from "@playwright/test";
import { login, createApprovedOrder } from "./helpers";

test("PO PDF endpoint serves application/pdf bytes and row links to it", async ({ page }) => {
  await login(page, "rita@hexprocure.dev");
  const options = await page.request.get("/api/v1/meta/options").then((r) => r.json());
  const supplierId = options.suppliers.find((s: { name: string }) => s.name === "Acme Office GmbH").id;
  const costCenterId = options.costCenters.find((c: { name: string }) => c.name === "IT").id;

  const { purchaseOrderId } = await createApprovedOrder(page.context().browser()!, supplierId, costCenterId);

  await page.goto("/purchase-orders");
  const row = page.locator("tr", { hasText: purchaseOrderId.slice(0, 8) }).first();
  await expect(row).toBeVisible();
  await expect(
    row.getByRole("link", { name: "PDF ↓" }),
  ).toHaveAttribute("href", `/api/v1/purchase-orders/${purchaseOrderId}/pdf`);

  const res = await page.request.get(`/api/v1/purchase-orders/${purchaseOrderId}/pdf`);
  expect(res.status()).toBe(200);
  expect(res.headers()["content-type"]).toContain("application/pdf");
  expect(res.headers()["content-disposition"]).toContain(".pdf");
  const body = await res.body();
  expect(body.subarray(0, 4).toString()).toBe("%PDF");
  expect(body.length).toBeGreaterThan(500);
});
