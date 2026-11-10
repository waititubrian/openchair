import "server-only";
import { dbOrTx, type Tx } from "./transaction";

// What the platform has paid out to a shop.

export function create(
  tenantId: string,
  data: { amountCents: number; phone: string; reference?: string | null; note?: string | null },
  tx?: Tx,
) {
  return dbOrTx(tx).payout.create({ data: { ...data, tenantId } });
}

export function listForTenant(tenantId: string, limit = 20, tx?: Tx) {
  return dbOrTx(tx).payout.findMany({ where: { tenantId }, orderBy: { createdAt: "desc" }, take: limit });
}

export async function sumPaidOut(tenantId: string, tx?: Tx) {
  const r = await dbOrTx(tx).payout.aggregate({ where: { tenantId }, _sum: { amountCents: true } });
  return r._sum.amountCents ?? 0;
}

/** Serialise payouts for one shop so the "can't exceed the balance" check can't be raced. */
export async function lockTenant(tenantId: string, tx: Tx) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`payout:${tenantId}`}))`;
}
