import "server-only";
import type { BookingStatus } from "@/lib/domain";
import { dbOrTx, type Tx } from "./transaction";

// Every function takes tenantId first and puts it in the WHERE clause. A booking id from
// another tenant simply doesn't match, so callers see "not found" rather than the row.

const withRelations = {
  service: { select: { id: true, name: true } },
  staff: { select: { id: true, name: true } },
  customer: { select: { id: true, name: true, email: true, phone: true } },
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

// ---- availability, creation and status (Phase 4) ---------------------------------------------


/** A held (PENDING_PAYMENT) booking blocks its slot only until holdExpiresAt. */
const notExpired = (now: Date) => ({
  OR: [
    { status: "CONFIRMED" as const },
    { status: "PENDING_PAYMENT" as const, OR: [{ holdExpiresAt: null }, { holdExpiresAt: { gte: now } }] },
  ],
});

/** Intervals that block these staff in [from, to): confirmed bookings and UNEXPIRED holds. */
export function listBusy(tenantId: string, staffIds: string[], from: Date, to: Date, now: Date, tx?: Tx) {
  return dbOrTx(tx).booking.findMany({
    where: { tenantId, staffId: { in: staffIds }, startsAt: { lt: to }, endsAt: { gt: from }, ...notExpired(now) },
    select: { staffId: true, startsAt: true, endsAt: true },
  });
}

/** How many live bookings each staff member has in a range (to spread "any available" fairly). */
export async function countLiveByStaff(tenantId: string, staffIds: string[], from: Date, to: Date, now: Date, tx?: Tx) {
  const rows = await dbOrTx(tx).booking.groupBy({
    by: ["staffId"],
    where: { tenantId, staffId: { in: staffIds }, startsAt: { lt: to }, endsAt: { gt: from }, ...notExpired(now) },
    _count: { _all: true },
  });
  return new Map(rows.map((r) => [r.staffId, r._count._all]));
}

/**
 * Free the slots of expired holds that overlap [from, to) for these staff. Must run before an
 * insert: the exclusion constraint cannot call now(), so an expired hold still blocks until its
 * status is flipped.
 */
export async function expireStaleHolds(tenantId: string, staffIds: string[], from: Date, to: Date, now: Date, tx?: Tx) {
  const { count } = await dbOrTx(tx).booking.updateMany({
    where: {
      tenantId,
      staffId: { in: staffIds },
      status: "PENDING_PAYMENT",
      holdExpiresAt: { lt: now },
      startsAt: { lt: to },
      endsAt: { gt: from },
    },
    data: { status: "CANCELLED", cancelledAt: now, cancelReason: "hold_expired" },
  });
  return count;
}

export type NewLiveBooking = {
  serviceId: string;
  staffId: string;
  customerId: string;
  startsAt: Date;
  endsAt: Date;
  priceCents: number;
  depositCents: number;
  status: Extract<BookingStatus, "PENDING_PAYMENT" | "CONFIRMED">;
  holdExpiresAt: Date | null;
};

export function createLive(tenantId: string, data: NewLiveBooking, tx?: Tx) {
  return dbOrTx(tx).booking.create({ data: { ...data, tenantId }, include: withRelations });
}

/** The same customer already holds this exact slot (a double-clicked submit): reuse, don't fail. */
export function findLiveForCustomerAt(tenantId: string, customerId: string, serviceId: string, startsAt: Date, now: Date, tx?: Tx) {
  return dbOrTx(tx).booking.findFirst({
    where: { tenantId, customerId, serviceId, startsAt, ...notExpired(now) },
    include: withRelations,
  });
}

export function countUpcomingLiveForCustomer(tenantId: string, customerId: string, now: Date, tx?: Tx) {
  return dbOrTx(tx).booking.count({ where: { tenantId, customerId, endsAt: { gt: now }, ...notExpired(now) } });
}

/** Look up by the unguessable public token (the tenant comes from the shop's slug in the URL). */
export function findByPublicToken(tenantId: string, publicToken: string, tx?: Tx) {
  return dbOrTx(tx).booking.findFirst({
    where: { tenantId, publicToken },
    select: {
      id: true,
      startsAt: true,
      endsAt: true,
      status: true,
      priceCents: true,
      depositCents: true,
      holdExpiresAt: true,
      service: { select: { name: true, durationMin: true } },
      staff: { select: { name: true } },
      customer: { select: { name: true } },
    },
  });
}

/** Move a booking to a new status only if it is currently in one of `from` (atomic guard). */
export async function transitionStatus(
  tenantId: string,
  bookingId: string,
  from: BookingStatus[],
  to: BookingStatus,
  now: Date,
  tx?: Tx,
) {
  const { count } = await dbOrTx(tx).booking.updateMany({
    where: { id: bookingId, tenantId, status: { in: from } },
    data: { status: to, ...(to === "CANCELLED" ? { cancelledAt: now, cancelReason: "shop" } : {}) },
  });
  return count > 0;
}

/** Dashboard list: upcoming (soonest first) or past (most recent first). */
export function listByView(tenantId: string, view: "upcoming" | "past", now: Date, limit = 100, tx?: Tx) {
  return dbOrTx(tx).booking.findMany({
    where: { tenantId, ...(view === "upcoming" ? { endsAt: { gte: now } } : { endsAt: { lt: now } }) },
    orderBy: { startsAt: view === "upcoming" ? "asc" : "desc" },
    take: limit,
    include: withRelations,
  });
}

// ---- payments (Phase 5) ------------------------------------------------------------------------

/** What payment code needs to know about a booking (no customer details beyond the email). */
export function findForPayment(tenantId: string, bookingId: string, tx?: Tx) {
  return dbOrTx(tx).booking.findFirst({
    where: { id: bookingId, tenantId },
    select: {
      id: true,
      status: true,
      cancelReason: true,
      holdExpiresAt: true,
      startsAt: true,
      depositCents: true,
      publicToken: true,
      service: { select: { name: true } },
      customer: { select: { email: true } },
    },
  });
}

export function findIdByPublicToken(tenantId: string, publicToken: string, tx?: Tx) {
  return dbOrTx(tx).booking.findFirst({ where: { tenantId, publicToken }, select: { id: true } });
}

/** Deposit received: PENDING_PAYMENT -> CONFIRMED (the status guard makes this safe to repeat). */
export async function confirmPending(tenantId: string, bookingId: string, tx?: Tx) {
  const { count } = await dbOrTx(tx).booking.updateMany({
    where: { id: bookingId, tenantId, status: "PENDING_PAYMENT" },
    data: { status: "CONFIRMED", holdExpiresAt: null },
  });
  return count > 0;
}

/** The Checkout Session expired or was abandoned: free the slot if the booking is still waiting. */
export async function cancelPending(tenantId: string, bookingId: string, reason: string, now: Date, tx?: Tx) {
  const { count } = await dbOrTx(tx).booking.updateMany({
    where: { id: bookingId, tenantId, status: "PENDING_PAYMENT" },
    data: { status: "CANCELLED", cancelledAt: now, cancelReason: reason, holdExpiresAt: null },
  });
  return count > 0;
}

/**
 * A customer paid AFTER their hold had been released. If nobody has taken the slot since, bring
 * the booking back; otherwise change nothing (the caller refunds). The NOT EXISTS is a read, so
 * a booking inserted at the same instant can still win: the exclusion constraint then rejects
 * this UPDATE, the webhook fails and Stripe retries, and the retry sees the new booking and refunds.
 */
export async function reviveExpired(tenantId: string, bookingId: string, tx?: Tx): Promise<boolean> {
  const rows = await dbOrTx(tx).$queryRaw<{ id: string }[]>`
    UPDATE "Booking" AS b
       SET "status" = 'CONFIRMED', "holdExpiresAt" = NULL, "cancelledAt" = NULL, "cancelReason" = NULL, "updatedAt" = now()
     WHERE b."id" = ${bookingId}
       AND b."tenantId" = ${tenantId}
       AND b."status" = 'CANCELLED'
       AND b."cancelReason" IN ('hold_expired', 'payment_expired')
       AND b."startsAt" > now()
       AND NOT EXISTS (
         SELECT 1 FROM "Booking" AS o
          WHERE o."staffId" = b."staffId"
            AND o."id" <> b."id"
            AND o."status" IN ('PENDING_PAYMENT', 'CONFIRMED')
            AND tstzrange(o."startsAt", o."endsAt") && tstzrange(b."startsAt", b."endsAt")
       )
    RETURNING b."id"
  `;
  return rows.length > 0;
}

/**
 * Housekeeping across ALL tenants (a scheduled job, not a request): cancel every expired hold.
 * Returns the cancelled bookings so their Checkout Sessions can be expired too.
 */
export async function expireAllStaleHolds(now: Date, tx?: Tx) {
  const db = dbOrTx(tx);
  const stale = await db.booking.findMany({
    where: { status: "PENDING_PAYMENT", holdExpiresAt: { lt: now } },
    select: { id: true, tenantId: true },
  });
  if (stale.length === 0) return [];
  await db.booking.updateMany({
    where: { id: { in: stale.map((b) => b.id) }, status: "PENDING_PAYMENT" },
    data: { status: "CANCELLED", cancelledAt: now, cancelReason: "hold_expired" },
  });
  return stale;
}
