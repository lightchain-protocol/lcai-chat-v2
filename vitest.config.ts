import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

/**
 * Unit tests only. The `test` script runs Playwright end-to-end specs, which
 * live outside these globs and must not be picked up here.
 */
export default defineConfig({
  resolve: {
    alias: {
      "@": resolve(import.meta.dirname, "."),
    },
  },
  test: {
    environment: "node",
    include: ["lib/**/*.test.ts", "hooks/**/*.test.ts"],
  },
});
