import "server-only";
import { dbOrTx, type Tx } from "./transaction";

// Tenant is the root of tenancy, so these two lookups are necessarily keyed by slug / id
// rather than "scoped by tenantId". They are the entry points that PRODUCE a tenantId.
// Every other repository method takes tenantId as its first argument.

export function findBySlug(slug: string, tx?: Tx) {
  return dbOrTx(tx).tenant.findUnique({ where: { slug } });
}

export function findById(tenantId: string, tx?: Tx) {
  return dbOrTx(tx).tenant.findUnique({ where: { id: tenantId } });
}

export async function slugExists(slug: string, tx?: Tx): Promise<boolean> {
  return (await dbOrTx(tx).tenant.count({ where: { slug } })) > 0;
}

export function create(
  data: { slug: string; name: string; timezone: string; depositHoldMinutes: number },
  tx?: Tx,
) {
  return dbOrTx(tx).tenant.create({ data });
}

export async function update(tenantId: string, data: { name?: string; timezone?: string }, tx?: Tx) {
  const { count } = await dbOrTx(tx).tenant.updateMany({ where: { id: tenantId }, data });
  return count > 0;
}
