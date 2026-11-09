import "server-only";
import { dbOrTx, type Tx } from "./transaction";

// Payments are tenant-owned: every function takes tenantId first.

export function create(
  tenantId: string,
  data: {
    bookingId: string;
    stripeCheckoutSessionId: string;
    amountCents: number;
    applicationFeeCents: number;
    currency: string;
  },
  tx?: Tx,
) {
  return dbOrTx(tx).payment.create({ data: { ...data, tenantId, status: "PENDING" } });
}

export function findBySessionId(tenantId: string, sessionId: string, tx?: Tx) {
  return dbOrTx(tx).payment.findFirst({ where: { tenantId, stripeCheckoutSessionId: sessionId } });
}

export function listForBooking(tenantId: string, bookingId: string, tx?: Tx) {
  return dbOrTx(tx).payment.findMany({ where: { tenantId, bookingId }, orderBy: { createdAt: "asc" } });
}

export function countForBooking(tenantId: string, bookingId: string, tx?: Tx) {
  return dbOrTx(tx).payment.count({ where: { tenantId, bookingId } });
}

/** Payments that could still be completed: used to expire their Checkout Sessions. */
export function listPendingForBookings(bookingIds: string[], tx?: Tx) {
  return dbOrTx(tx).payment.findMany({
    where: { bookingId: { in: bookingIds }, status: "PENDING" },
    select: { id: true, tenantId: true, stripeCheckoutSessionId: true, tenant: { select: { stripeAccountId: true } } },
  });
}

export async function markSucceeded(tenantId: string, paymentId: string, paymentIntentId: string | null, tx?: Tx) {
  const { count } = await dbOrTx(tx).payment.updateMany({
    where: { id: paymentId, tenantId, status: { in: ["PENDING", "FAILED"] } },
    data: { status: "SUCCEEDED", stripePaymentIntentId: paymentIntentId, failureReason: null },
  });
  return count > 0;
}

export function markFailed(tenantId: string, paymentId: string, reason: string, tx?: Tx) {
  return dbOrTx(tx).payment.updateMany({
    where: { id: paymentId, tenantId, status: "PENDING" },
    data: { status: "FAILED", failureReason: reason },
  });
}

/** A card attempt failed but the Checkout Session is still open (the customer can retry): just note why. */
export function noteFailureReason(tenantId: string, paymentId: string, reason: string, tx?: Tx) {
  return dbOrTx(tx).payment.updateMany({
    where: { id: paymentId, tenantId, status: "PENDING" },
    data: { failureReason: reason },
  });
}

export function markRefunded(tenantId: string, paymentId: string, tx?: Tx) {
  return dbOrTx(tx).payment.updateMany({ where: { id: paymentId, tenantId }, data: { status: "REFUNDED" } });
}
