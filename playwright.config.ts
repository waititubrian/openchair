import "dotenv/config";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineConfig, devices } from "@playwright/test";

// E2E runs against the dev server on port 3000 (reusing one that is already running, or starting
// one). Better Auth rate limiting is production-only, so repeated sign-ins in tests aren't throttled.
// If you changed the Prisma schema, restart a running dev server first (or just save a file that
// imports the client): see src/lib/prisma.ts.
// Needs Postgres up and seeded:  npm run db:up && npm run db:migrate && npm run db:seed
export default defineConfig({
  testDir: "tests/e2e",
  // Keep traces/artifacts OUTSIDE the project: the Next dev server watches the project folder and
  // would hot-reload pages in the middle of a test whenever Playwright writes a file.
  outputDir: join(tmpdir(), "openchair-playwright"),
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
