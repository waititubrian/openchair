import "dotenv/config";
import { defineConfig, devices } from "@playwright/test";

// E2E runs against the dev server (rate limiting is production-only in Better Auth, so
// repeated logins in tests aren't throttled). Needs Postgres up and seeded:
//   npm run db:up && npm run db:migrate && npm run db:seed
export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: true,
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"]],
  use: { baseURL: "http://localhost:3000", trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "npm run dev",
    url: "http://localhost:3000",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
