import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
import "dotenv/config";

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

// Integration tests hit the REAL local Postgres (docker compose up -d, migrated).
export default defineConfig({
  resolve: { alias: { "@": r("./src"), "server-only": r("./tests/stubs/server-only.ts") } },
  test: { include: ["tests/integration/**/*.test.ts"], fileParallelism: false, testTimeout: 20_000 },
});
