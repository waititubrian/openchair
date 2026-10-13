import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";

/**
 * Opaque transaction handle. Services get one from runInTransaction() and pass it
 * to repository calls (the optional trailing `tx` argument) without ever importing
 * Prisma themselves.
 */
export type Tx = Prisma.TransactionClient;

export function runInTransaction<T>(
  fn: (tx: Tx) => Promise<T>,
  options?: { timeoutMs?: number },
): Promise<T> {
  return prisma.$transaction(fn, options?.timeoutMs ? { timeout: options.timeoutMs } : undefined);
}

/** Repositories call this: use the caller's transaction if given, else the shared client. */
export function dbOrTx(tx?: Tx) {
  return tx ?? prisma;
}
