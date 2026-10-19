import "server-only";
import { dbOrTx, type Tx } from "./transaction";

export type ServiceFields = {
  name: string;
  description: string | null;
  durationMin: number;
  priceCents: number;
  depositCents: number;
  active: boolean;
};

export function create(
  tenantId: string,
  data: Pick<ServiceFields, "name" | "durationMin" | "priceCents" | "depositCents"> &
    Partial<Pick<ServiceFields, "description" | "active">>,
  tx?: Tx,
) {
  return dbOrTx(tx).service.create({ data: { ...data, tenantId } });
}

export function list(tenantId: string, tx?: Tx) {
  return dbOrTx(tx).service.findMany({ where: { tenantId }, orderBy: { name: "asc" } });
}

export function findById(tenantId: string, serviceId: string, tx?: Tx) {
  return dbOrTx(tx).service.findFirst({ where: { id: serviceId, tenantId } });
}

/** How many of these ids belong to the tenant (callers compare against the requested count). */
export function countByIds(tenantId: string, ids: string[], tx?: Tx) {
  return dbOrTx(tx).service.count({ where: { tenantId, id: { in: ids } } });
}

/** updateMany with tenantId in WHERE: a foreign id updates 0 rows. Returns whether a row matched. */
export async function update(tenantId: string, serviceId: string, data: Partial<ServiceFields>, tx?: Tx) {
  const { count } = await dbOrTx(tx).service.updateMany({ where: { id: serviceId, tenantId }, data });
  return count > 0;
}

export async function remove(tenantId: string, serviceId: string, tx?: Tx) {
  const { count } = await dbOrTx(tx).service.deleteMany({ where: { id: serviceId, tenantId } });
  return count > 0;
}

export async function listStaffIds(tenantId: string, serviceId: string, tx?: Tx): Promise<string[]> {
  const rows = await dbOrTx(tx).staffService.findMany({ where: { tenantId, serviceId }, select: { staffId: true } });
  return rows.map((r) => r.staffId);
}

/** Replace who offers a service. Both ids are checked by the caller; composite FKs back that up. */
export async function setStaff(tenantId: string, serviceId: string, staffIds: string[], tx?: Tx) {
  const db = dbOrTx(tx);
  await db.staffService.deleteMany({ where: { tenantId, serviceId } });
  if (staffIds.length) {
    await db.staffService.createMany({ data: staffIds.map((staffId) => ({ tenantId, serviceId, staffId })) });
  }
}
