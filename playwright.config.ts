import { defineConfig } from "@playwright/test";
import { config } from "dotenv";
import path from "node:path";

config({ path: ".env.e2e" });

const PORT = Number(process.env.E2E_PORT ?? 3100);
const baseURL = process.env.E2E_BASE_URL ?? `http://localhost:${PORT}`;

const webServerEnv: Record<string, string> = {
  DATABASE_URL: process.env.DATABASE_URL!,
  AUTH_SECRET: process.env.AUTH_SECRET!,
  INTEGRATION_ENC_KEY: process.env.INTEGRATION_ENC_KEY ?? "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
  NODE_ENV: "production",
};
for (const key of [
  "RATE_LIMIT_AUTH_PER_MIN",
  "RATE_LIMIT_MUTATION_PER_MIN",
  "RATE_LIMIT_READ_PER_MIN",
  "INTEGRATION_OCR_URL",
]) {
  if (process.env[key]) webServerEnv[key] = process.env[key]!;
}

export default defineConfig({
  testDir: path.join(__dirname, "tests/e2e"),
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL,
    trace: "retain-on-failure",
  },
  globalSetup: path.join(__dirname, "tests/e2e/global-setup.ts"),
  webServer: {
    command: `npx next start -p ${PORT}`,
    url: `${baseURL}/api/health`,
    reuseExistingServer: !process.env.CI,
    env: webServerEnv,
    timeout: 60_000,
  },
});
