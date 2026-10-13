import "server-only";
import { dbOrTx, type Tx } from "./transaction";

export type WeeklyRule = { dayOfWeek: number; startMinute: number; endMinute: number };

export function listWeekly(tenantId: string, staffId: string, tx?: Tx) {
  return dbOrTx(tx).availabilityRule.findMany({
    where: { tenantId, staffId },
    orderBy: [{ dayOfWeek: "asc" }, { startMinute: "asc" }],
    select: { dayOfWeek: true, startMinute: true, endMinute: true },
  });
}

/** Replace a staff member's whole weekly schedule. */
export async function replaceWeekly(tenantId: string, staffId: string, rules: WeeklyRule[], tx?: Tx) {
  const db = dbOrTx(tx);
  await db.availabilityRule.deleteMany({ where: { tenantId, staffId } });
  return db.availabilityRule.createMany({
    data: rules.map((r) => ({ ...r, tenantId, staffId })),
  });
}
