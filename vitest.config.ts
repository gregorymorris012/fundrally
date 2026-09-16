import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      // See tests/mocks/server-only.ts — Vitest-only, doesn't touch how
      // Next itself resolves the real "server-only" package.
      "server-only": fileURLToPath(new URL("./tests/mocks/server-only.ts", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    setupFiles: ["./tests/setup-env.ts"],
    testTimeout: 20_000,
  },
});
