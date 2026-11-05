import "server-only";
import { dbOrTx, type Tx } from "./transaction";

export function listForStaff(tenantId: string, staffId: string, tx?: Tx) {
  return dbOrTx(tx).timeOff.findMany({ where: { tenantId, staffId }, orderBy: { startsAt: "asc" } });
}

export function findById(tenantId: string, timeOffId: string, tx?: Tx) {
  return dbOrTx(tx).timeOff.findFirst({ where: { id: timeOffId, tenantId } });
}

export function create(
  tenantId: string,
  data: { staffId: string; startsAt: Date; endsAt: Date; reason?: string },
  tx?: Tx,
) {
  return dbOrTx(tx).timeOff.create({ data: { ...data, tenantId } });
}

export async function remove(tenantId: string, timeOffId: string, tx?: Tx) {
  const { count } = await dbOrTx(tx).timeOff.deleteMany({ where: { id: timeOffId, tenantId } });
  return count > 0;
}

/** Time off that overlaps [from, to) for these staff. */
export function listOverlapping(tenantId: string, staffIds: string[], from: Date, to: Date, tx?: Tx) {
  return dbOrTx(tx).timeOff.findMany({
    where: { tenantId, staffId: { in: staffIds }, startsAt: { lt: to }, endsAt: { gt: from } },
    select: { staffId: true, startsAt: true, endsAt: true },
  });
}
