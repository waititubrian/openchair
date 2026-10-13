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
