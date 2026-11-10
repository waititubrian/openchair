import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@": r("./src"),
      // `server-only` throws outside a React Server environment; stub it for unit tests.
      "server-only": r("./tests/stubs/server-only.ts"),
    },
  },
  test: {
    // env.ts validates these on import; unit tests never connect to anything.
    env: { DATABASE_URL: "postgresql://unused:unused@localhost:1/unused", APP_URL: "http://localhost:3000" },
    include: ["tests/unit/**/*.test.ts"] },
});
