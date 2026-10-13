import "server-only";
import type { MembershipRole } from "@/lib/domain";
import { dbOrTx, type Tx } from "./transaction";

/** The shop a signed-in user works in (oldest membership). Starting point for tenantId. */
export function findPrimaryForUser(userId: string, tx?: Tx) {
  return dbOrTx(tx).membership.findFirst({
    where: { userId },
    orderBy: { createdAt: "asc" },
    include: { tenant: true },
  });
}

export async function userHasMembership(userId: string, tx?: Tx): Promise<boolean> {
  return (await dbOrTx(tx).membership.count({ where: { userId } })) > 0;
}

export function create(tenantId: string, userId: string, role: MembershipRole, tx?: Tx) {
  return dbOrTx(tx).membership.create({ data: { tenantId, userId, role } });
}
