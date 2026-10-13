import "server-only";
import { dbOrTx, type Tx } from "./transaction";

// Users are global (not tenant-owned), like Tenant: looked up by their own id.
// Better Auth itself writes the User/Session/Account rows; this is read access for us.
export function findById(userId: string, tx?: Tx) {
  return dbOrTx(tx).user.findUnique({
    where: { id: userId },
    select: { id: true, name: true, email: true, platformRole: true },
  });
}
