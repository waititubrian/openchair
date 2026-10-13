import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";

// Tests build their own client: they run outside Next, so they can't use the server-only
// repositories. (Production code never touches Prisma outside src/repositories.)
export function createTestPrisma() {
  return new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) });
}
export type TestPrisma = ReturnType<typeof createTestPrisma>;
