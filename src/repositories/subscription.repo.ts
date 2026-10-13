import "server-only";
import { dbOrTx, type Tx } from "./transaction";

export function findByTenant(tenantId: string, tx?: Tx) {
  return dbOrTx(tx).subscription.findUnique({ where: { tenantId } });
}
