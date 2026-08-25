import { test, expect } from "@playwright/test";
import { login } from "./helpers";

test.describe("auth round-trip", () => {
  test("wrong credentials show an inline error and stay on /login", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Email").fill("rita@hexprocure.dev");
    await page.getByLabel("Password").fill("definitely-wrong");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.getByTestId("login-error")).toBeVisible();
    expect(new URL(page.url()).pathname).toBe("/login");
  });

  test("unauthenticated page visit redirects to /login", async ({ page }) => {
    await page.goto("/requisitions");
    await page.waitForURL("**/login");
  });

  test("valid login lands on dashboard and session survives reload", async ({ page }) => {
    await login(page, "rita@hexprocure.dev");
    await expect(page.getByRole("heading", { name: "Welcome back, Rita" })).toBeVisible();
    await page.reload();
    await expect(page.getByRole("heading", { name: "Welcome back, Rita" })).toBeVisible();
  });

  test("logout ends the session", async ({ page }) => {
    await login(page, "rita@hexprocure.dev");
    await page.getByRole("button", { name: "Sign out" }).click();
    await page.waitForURL("**/login");
    await page.goto("/dashboard");
    await page.waitForURL("**/login");
  });
});
