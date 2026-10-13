import "server-only";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import { env } from "@/lib/env";

// Prisma 7 talks to Postgres through a driver adapter. On Neon, DATABASE_URL must be
// the POOLED connection string, otherwise serverless functions exhaust connections.
// The client is cached on globalThis so hot reload in dev doesn't open a new pool each time.
//
// IMPORTANT: only src/repositories/** may import this file (enforced by ESLint).
// Everything else reaches the database through a repository, which scopes by tenantId.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({ adapter: new PrismaPg({ connectionString: env.DATABASE_URL }) });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
