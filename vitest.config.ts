import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    setupFiles: ["./tests/setup-env.ts"],
    testTimeout: 20_000,
  },
});
