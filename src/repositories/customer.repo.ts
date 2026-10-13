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
