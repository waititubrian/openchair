import "server-only";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import { env } from "@/lib/env";

// Prisma 7 talks to Postgres through a driver adapter. On Neon, DATABASE_URL must be
// the POOLED connection string, otherwise serverless functions exhaust connections.
//
// The client is cached on globalThis so hot reload in dev doesn't open a new pool each time. The
// cache is also tagged with the generated PrismaClient CLASS it came from: after `prisma generate`
// (e.g. a new column) the class is a new one, so a long-running dev server builds a fresh client
// instead of serving queries with the old, stale schema.
//
// IMPORTANT: only src/repositories/** may import this file (enforced by ESLint).
// Everything else reaches the database through a repository, which scopes by tenantId.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient; prismaClass?: unknown };

function createClient(): PrismaClient {
  return new PrismaClient({ adapter: new PrismaPg({ connectionString: env.DATABASE_URL }) });
}

if (!globalForPrisma.prisma || globalForPrisma.prismaClass !== PrismaClient) {
  // The old client is deliberately NOT disconnected: in dev, separate route bundles can each see a
  // different PrismaClient class and would end a pool another bundle is still using.
  globalForPrisma.prisma = createClient();
  globalForPrisma.prismaClass = PrismaClient;
}

export const prisma: PrismaClient = globalForPrisma.prisma;
