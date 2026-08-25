import { test, expect } from "@playwright/test";
import { login, createApprovedOrder } from "./helpers";

test("attachment upload through the real file input lands in the list", async ({ page }) => {
  await login(page, "rita@hexprocure.dev");

  // guarantee an entity exists to attach to
  const options = await page.request.get("/api/v1/meta/options").then((r) => r.json());
  const supplierId = options.suppliers.find((s: { name: string }) => s.name === "Acme Office GmbH").id;
  const costCenterId = options.costCenters.find((c: { name: string }) => c.name === "IT").id;
  await createApprovedOrder(page.context().browser()!, supplierId, costCenterId);

  await page.goto("/attachments");
  await page.getByLabel("Document type").selectOption("requisition");
  const entitySelect = page.getByLabel("Attach to");
  await expect(entitySelect).toBeEnabled({ timeout: 10_000 });
  const entities = await page
    .request
    .get("/api/v1/meta/entities?type=requisition")
    .then((r) => r.json());
  await entitySelect.selectOption(entities.entities[0].id);

  await page
    .locator("#file-input")
    .setInputFiles({
      name: "e2e-proof.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("HexProcure E2E attachment upload proof"),
    });
  await page.getByRole("button", { name: "Upload" }).click();

  await expect(page.getByText("Uploaded ✓")).toBeVisible();
  const listRow = page.locator("div", { hasText: "e2e-proof.txt" }).filter({
    has: page.locator("a"),
  }).first();
  await expect(listRow).toBeVisible();
});
