import { test, expect } from "@playwright/test";
import { login } from "./helpers";

test("QBO status card renders disconnected and offers no connect for FINANCE", async ({ page }) => {
  await login(page, "fiona@hexprocure.dev");
  await page.goto("/dashboard");

  const card = page.locator("div.rounded-xl").filter({ hasText: "QuickBooks Online" });
  await expect(card).toBeVisible();
  await expect(
    card.getByText(/NEVER_CONNECTED|Not connected/),
  ).toBeVisible();
  await expect(card.getByRole("button", { name: "Disconnect" })).toBeHidden();
});
