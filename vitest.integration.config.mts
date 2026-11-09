import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
import "dotenv/config";

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

// Integration tests hit the REAL local Postgres (docker compose up -d, migrated).
export default defineConfig({
  resolve: { alias: { "@": r("./src"), "server-only": r("./tests/stubs/server-only.ts") } },
  test: {
    // Deterministic fake credentials: tests never talk to Stripe (it is replaced by a fake) but the
    // real signature verification runs, with this secret.
    env: {
      STRIPE_SECRET_KEY: "sk_test_integration_fake",
      STRIPE_CONNECT_WEBHOOK_SECRET: "whsec_integration_connect",
      CRON_SECRET: "cron-secret-for-tests",
      APP_URL: "http://localhost:3000",
    },
    include: ["tests/integration/**/*.test.ts"], fileParallelism: false, testTimeout: 20_000 },
});
