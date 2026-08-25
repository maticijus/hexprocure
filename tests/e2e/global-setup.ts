import { execSync } from "node:child_process";

export default function globalSetup() {
  const env = { ...process.env } as NodeJS.ProcessEnv;
  if (!env.DATABASE_URL) {
    throw new Error("DATABASE_URL missing — create .env.e2e (see .env.example)");
  }
  execSync("npx drizzle-kit migrate", { stdio: "inherit", env });
  execSync("npx tsx scripts/e2e-seed.ts", { stdio: "inherit", env });
}
