import "server-only";
import { dbOrTx, type Tx } from "./transaction";

export function findByTenant(tenantId: string, tx?: Tx) {
  return dbOrTx(tx).subscription.findUnique({ where: { tenantId } });
}

/** Set the end of the paid period (creating the subscription on the first payment). */
export function upsertPeriod(tenantId: string, plan: "FREE" | "PRO", currentPeriodEnd: Date, tx?: Tx) {
  return dbOrTx(tx).subscription.upsert({
    where: { tenantId },
    create: { tenantId, plan, currentPeriodEnd },
    update: { plan, currentPeriodEnd },
  });
}

/** Subscriptions whose paid period AND grace period have both passed, for shops still on PRO. */
export function listLapsed(lapsedBefore: Date, tx?: Tx) {
  return dbOrTx(tx).subscription.findMany({
    where: { currentPeriodEnd: { lt: lapsedBefore }, tenant: { plan: "PRO" } },
    select: { tenantId: true, currentPeriodEnd: true },
  });
}
