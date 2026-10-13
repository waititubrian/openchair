import "dotenv/config";
import { defineConfig } from "prisma/config";

// Migrations need a direct (non-pooled) connection on Neon, so prefer DIRECT_URL.
// The app itself connects with the pooled DATABASE_URL (see src/server/db/prisma.ts).
export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx --conditions=react-server prisma/seed.ts",
  },
  datasource: {
    url: process.env.DIRECT_URL ?? process.env.DATABASE_URL ?? "",
  },
});
