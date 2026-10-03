import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      // The entry has no functions; tests/bin.test.ts runs it as built.
      exclude: ["src/bin.ts"],
      reporter: ["text", "lcov"],
    },
  },
});
