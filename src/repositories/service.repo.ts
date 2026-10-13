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
  data: { name: string; durationMin: number; priceCents: number; depositCents: number },
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

/** updateMany with tenantId in WHERE: a foreign id updates 0 rows. Returns whether a row matched. */
export async function update(tenantId: string, serviceId: string, data: Partial<ServiceFields>, tx?: Tx) {
  const { count } = await dbOrTx(tx).service.updateMany({ where: { id: serviceId, tenantId }, data });
  return count > 0;
}
