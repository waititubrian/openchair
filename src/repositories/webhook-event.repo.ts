import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";

/** What the ledger keeps of an event: ids and types only, no customer details. */
export type LedgerEntry = {
  id: string;
  source: string;
  type: string;
  payload: Record<string, string | number | null>;
};
import { dbOrTx, type Tx } from "./transaction";

// The idempotency ledger. The primary key is "mpesa:<CheckoutRequestID>". Deliberately not tenant-scoped:
// an event arrives before we know which tenant it concerns.

/**
 * Claim an event id. Returns true if this call inserted the row. Uses ON CONFLICT DO NOTHING
 * (skipDuplicates), so a duplicate never raises (an error would abort the surrounding Postgres
 * transaction). A concurrent duplicate blocks here until the first transaction finishes.
 */
export async function claim(
  event: LedgerEntry,
  tx?: Tx,
): Promise<boolean> {
  const { count } = await dbOrTx(tx).webhookEvent.createMany({ data: [{ ...event, payload: event.payload as Prisma.InputJsonValue }], skipDuplicates: true });
  return count === 1;
}

export function findById(id: string, tx?: Tx) {
  return dbOrTx(tx).webhookEvent.findUnique({ where: { id } });
}

export function markProcessed(id: string, tx?: Tx) {
  return dbOrTx(tx).webhookEvent.update({ where: { id }, data: { processedAt: new Date(), error: null } });
}

/** Written OUTSIDE the failed transaction (which rolled back) so the failure is visible. */
export async function recordFailure(event: LedgerEntry, message: string) {
  const data = { ...event, payload: event.payload as Prisma.InputJsonValue };
  await prisma.webhookEvent.upsert({
    where: { id: event.id },
    create: { ...data, error: message.slice(0, 500) },
    update: { error: message.slice(0, 500) },
  });
}
