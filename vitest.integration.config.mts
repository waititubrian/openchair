import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
import "dotenv/config";
import { testDatabaseUrl } from "./tests/setup/test-db.ts";

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

// Integration tests hit the REAL local Postgres (docker compose up -d, migrated).
export default defineConfig({
  resolve: { alias: { "@": r("./src"), "server-only": r("./tests/stubs/server-only.ts") } },
  test: {
    // Own database (<name>_test), created and migrated by the global setup. Never the dev database.
    globalSetup: ["./tests/setup/test-db.ts"],
    // Deterministic fake settings. Tests replace the Daraja gateway with a fake (no network); the callback
    // route's URL secret and the cron secret are checked for real against these values.
    env: {
      DATABASE_URL: testDatabaseUrl(),
      DIRECT_URL: testDatabaseUrl(),
      MPESA_CALLBACK_SECRET: "test-callback-secret-0123456789",
      CRON_SECRET: "cron-secret-for-tests",
      APP_URL: "http://localhost:3000",
    },
    include: ["tests/integration/**/*.test.ts"], fileParallelism: false, testTimeout: 20_000 },
});
