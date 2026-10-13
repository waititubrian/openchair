import "server-only";
import { dbOrTx, type Tx } from "./transaction";

export function create(tenantId: string, data: { name: string; userId?: string }, tx?: Tx) {
  return dbOrTx(tx).staffMember.create({ data: { ...data, tenantId } });
}

export function list(tenantId: string, tx?: Tx) {
  return dbOrTx(tx).staffMember.findMany({ where: { tenantId }, orderBy: { name: "asc" } });
}

export function findById(tenantId: string, staffId: string, tx?: Tx) {
  return dbOrTx(tx).staffMember.findFirst({ where: { id: staffId, tenantId } });
}

export async function update(
  tenantId: string,
  staffId: string,
  data: { name?: string; active?: boolean },
  tx?: Tx,
) {
  const { count } = await dbOrTx(tx).staffMember.updateMany({ where: { id: staffId, tenantId }, data });
  return count > 0;
}

/** Which services this staff member performs. The composite FKs reject other tenants' ids. */
export function assignServices(tenantId: string, staffId: string, serviceIds: string[], tx?: Tx) {
  return dbOrTx(tx).staffService.createMany({
    data: serviceIds.map((serviceId) => ({ tenantId, staffId, serviceId })),
  });
}
