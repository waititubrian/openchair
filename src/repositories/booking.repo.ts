import "server-only";
import { dbOrTx, type Tx } from "./transaction";

// Every function takes tenantId first and puts it in the WHERE clause. A booking id from
// another tenant simply doesn't match, so callers see "not found" rather than the row.

const withRelations = {
  service: { select: { id: true, name: true } },
  staff: { select: { id: true, name: true } },
  customer: { select: { id: true, name: true, email: true } },
} as const;

export function list(tenantId: string, opts: { limit?: number } = {}, tx?: Tx) {
  return dbOrTx(tx).booking.findMany({
    where: { tenantId },
    orderBy: { startsAt: "desc" },
    take: opts.limit ?? 50,
    include: withRelations,
  });
}

export function findById(tenantId: string, bookingId: string, tx?: Tx) {
  return dbOrTx(tx).booking.findFirst({ where: { id: bookingId, tenantId }, include: withRelations });
}

/** Bookings that reference a service / staff member (any status). Used to block hard deletes. */
export function countForService(tenantId: string, serviceId: string, tx?: Tx) {
  return dbOrTx(tx).booking.count({ where: { tenantId, serviceId } });
}

export function countForStaff(tenantId: string, staffId: string, tx?: Tx) {
  return dbOrTx(tx).booking.count({ where: { tenantId, staffId } });
}
