import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["app/**/*.test.ts", "tests/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: ["app/lib/**"],
      thresholds: { branches: 90, functions: 90, lines: 90 }
    }
  }
});
