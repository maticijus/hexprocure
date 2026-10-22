import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/live/**/*.test.ts"],
    setupFiles: ["./scripts/test-env.ts"],
    fileParallelism: false,
    testTimeout: 60_000,
  },
  resolve: {
    alias: { "@": path.resolve(__dirname, "src") },
  },
});
