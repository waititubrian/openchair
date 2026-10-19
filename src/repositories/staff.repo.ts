import "server-only";
import { dbOrTx, type Tx } from "./transaction";

export function create(tenantId: string, data: { name: string; userId?: string; active?: boolean }, tx?: Tx) {
  return dbOrTx(tx).staffMember.create({ data: { ...data, tenantId } });
}

export function list(tenantId: string, tx?: Tx) {
  return dbOrTx(tx).staffMember.findMany({ where: { tenantId }, orderBy: { name: "asc" } });
}

export function findById(tenantId: string, staffId: string, tx?: Tx) {
  return dbOrTx(tx).staffMember.findFirst({ where: { id: staffId, tenantId } });
}

/** The StaffMember linked to a signed-in user (STAFF users manage only this one's schedule). */
export function findByUserId(tenantId: string, userId: string, tx?: Tx) {
  return dbOrTx(tx).staffMember.findFirst({ where: { tenantId, userId } });
}

export function countActive(tenantId: string, tx?: Tx) {
  return dbOrTx(tx).staffMember.count({ where: { tenantId, active: true } });
}

export function countByIds(tenantId: string, ids: string[], tx?: Tx) {
  return dbOrTx(tx).staffMember.count({ where: { tenantId, id: { in: ids } } });
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

export async function remove(tenantId: string, staffId: string, tx?: Tx) {
  const { count } = await dbOrTx(tx).staffMember.deleteMany({ where: { id: staffId, tenantId } });
  return count > 0;
}

export async function listServiceIds(tenantId: string, staffId: string, tx?: Tx): Promise<string[]> {
  const rows = await dbOrTx(tx).staffService.findMany({ where: { tenantId, staffId }, select: { serviceId: true } });
  return rows.map((r) => r.serviceId);
}

/** Which services this staff member performs. The composite FKs reject other tenants' ids. */
export function assignServices(tenantId: string, staffId: string, serviceIds: string[], tx?: Tx) {
  return dbOrTx(tx).staffService.createMany({
    data: serviceIds.map((serviceId) => ({ tenantId, staffId, serviceId })),
  });
}

/** Replace the services a staff member performs. */
export async function setServices(tenantId: string, staffId: string, serviceIds: string[], tx?: Tx) {
  await dbOrTx(tx).staffService.deleteMany({ where: { tenantId, staffId } });
  if (serviceIds.length) await assignServices(tenantId, staffId, serviceIds, tx);
}
