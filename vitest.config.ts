import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    setupFiles: ["dotenv/config"],
    fileParallelism: false,
    coverage: {
      provider: "v8",
      // Strict gate on business logic. Route handlers are one-line adapters
      // exercised by integration tests; src/lib/db is a vendor adapter.
      include: ["src/domain/**", "src/lib/services/**", "src/lib/api/**"],
      thresholds: {
        global: { branches: 80, functions: 80, lines: 80, statements: 80 },
      },
    },
  },
  resolve: {
    alias: { "@": path.resolve(__dirname, "src") },
  },
});
