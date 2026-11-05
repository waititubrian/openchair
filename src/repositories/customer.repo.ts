import "server-only";
import { dbOrTx, type Tx } from "./transaction";

export function list(tenantId: string, opts: { limit?: number } = {}, tx?: Tx) {
  return dbOrTx(tx).customer.findMany({
    where: { tenantId },
    orderBy: { name: "asc" },
    take: opts.limit ?? 100,
  });
}

export function findById(tenantId: string, customerId: string, tx?: Tx) {
  return dbOrTx(tx).customer.findFirst({ where: { id: customerId, tenantId } });
}

/** One customer row per (shop, email). Name and phone follow the most recent booking. */
export function upsertByEmail(
  tenantId: string,
  data: { name: string; email: string; phone?: string | null },
  tx?: Tx,
) {
  return dbOrTx(tx).customer.upsert({
    where: { tenantId_email: { tenantId, email: data.email } },
    create: { tenantId, name: data.name, email: data.email, phone: data.phone ?? null },
    update: { name: data.name, ...(data.phone ? { phone: data.phone } : {}) },
  });
}

export function findByEmail(tenantId: string, email: string, tx?: Tx) {
  return dbOrTx(tx).customer.findUnique({ where: { tenantId_email: { tenantId, email } } });
}
