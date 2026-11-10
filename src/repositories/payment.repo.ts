import "server-only";
import { dbOrTx, type Tx } from "./transaction";

// Booking deposits paid by M-Pesa. Tenant-scoped except findByCheckoutRequestId: an M-Pesa callback
// identifies the payment only by Safaricom's CheckoutRequestID, so that lookup is how the tenant is
// discovered (the id is unguessable and we only ever created rows for prompts we sent).

export function create(
  tenantId: string,
  data: {
    bookingId: string;
    phone: string;
    amountCents: number;
    applicationFeeCents: number;
    currency: string;
    merchantRequestId: string;
    checkoutRequestId: string;
    /** The caller's "now", so all time maths (rate limits, expiry) uses one clock. */
    createdAt: Date;
  },
  tx?: Tx,
) {
  return dbOrTx(tx).payment.create({ data: { ...data, tenantId, status: "PENDING" } });
}

export function findByCheckoutRequestId(checkoutRequestId: string, tx?: Tx) {
  return dbOrTx(tx).payment.findUnique({ where: { checkoutRequestId } });
}

export function listForBooking(tenantId: string, bookingId: string, tx?: Tx) {
  return dbOrTx(tx).payment.findMany({ where: { tenantId, bookingId }, orderBy: { createdAt: "asc" } });
}

/** Deposits still waiting on the customer, oldest first: used to expire abandoned prompts. */
export function listStalePending(olderThan: Date, tx?: Tx) {
  return dbOrTx(tx).payment.findMany({
    where: { status: "PENDING", createdAt: { lt: olderThan } },
    select: { id: true, tenantId: true, checkoutRequestId: true },
  });
}

export async function markSucceeded(
  tenantId: string,
  paymentId: string,
  result: { receipt: string | null; resultCode: number; resultDesc: string },
  tx?: Tx,
) {
  // The status guard means exactly one of two racing callers (callback vs status poll) wins.
  const { count } = await dbOrTx(tx).payment.updateMany({
    where: { id: paymentId, tenantId, status: "PENDING" },
    data: { status: "SUCCEEDED", mpesaReceipt: result.receipt, resultCode: result.resultCode, resultDesc: result.resultDesc, failureReason: null },
  });
  return count > 0;
}

export async function markFailed(
  tenantId: string,
  paymentId: string,
  result: { resultCode: number; resultDesc: string; reason: string },
  tx?: Tx,
) {
  const { count } = await dbOrTx(tx).payment.updateMany({
    where: { id: paymentId, tenantId, status: "PENDING" },
    data: { status: "FAILED", resultCode: result.resultCode, resultDesc: result.resultDesc, failureReason: result.reason },
  });
  return count > 0;
}

/** Money arrived but the booking can't be honoured: flagged for a manual refund. */
export function markNeedsRefund(tenantId: string, paymentId: string, reason: string, tx?: Tx) {
  return dbOrTx(tx).payment.updateMany({ where: { id: paymentId, tenantId, status: "SUCCEEDED" }, data: { status: "NEEDS_REFUND", failureReason: reason } });
}

export function markRefunded(tenantId: string, paymentId: string, tx?: Tx) {
  return dbOrTx(tx).payment.updateMany({ where: { id: paymentId, tenantId, status: "NEEDS_REFUND" }, data: { status: "REFUNDED" } });
}

export function touchQueried(tenantId: string, paymentId: string, at: Date, tx?: Tx) {
  return dbOrTx(tx).payment.updateMany({ where: { id: paymentId, tenantId }, data: { lastQueriedAt: at } });
}

// ---- ledger (what the platform owes a shop) ---------------------------------------------------

/** Totals of successful deposits: gross collected and the platform's fee on them. */
export async function sumCollected(tenantId: string, tx?: Tx) {
  const r = await dbOrTx(tx).payment.aggregate({
    where: { tenantId, status: "SUCCEEDED" },
    _sum: { amountCents: true, applicationFeeCents: true },
    _count: { _all: true },
  });
  return { collectedCents: r._sum.amountCents ?? 0, feeCents: r._sum.applicationFeeCents ?? 0, count: r._count._all };
}

export function listRecent(tenantId: string, limit = 20, tx?: Tx) {
  return dbOrTx(tx).payment.findMany({
    where: { tenantId },
    orderBy: { createdAt: "desc" },
    take: limit,
    select: {
      id: true,
      status: true,
      amountCents: true,
      applicationFeeCents: true,
      mpesaReceipt: true,
      createdAt: true,
      booking: { select: { startsAt: true, service: { select: { name: true } }, customer: { select: { name: true } } } },
    },
  });
}

export function listNeedingRefund(tenantId: string, tx?: Tx) {
  return dbOrTx(tx).payment.findMany({ where: { tenantId, status: "NEEDS_REFUND" }, orderBy: { createdAt: "desc" } });
}

/** A status poll confirmed success before the callback arrived; the callback later supplies the receipt. */
export function setReceiptIfMissing(tenantId: string, paymentId: string, receipt: string, tx?: Tx) {
  return dbOrTx(tx).payment.updateMany({ where: { id: paymentId, tenantId, mpesaReceipt: null, status: { in: ["SUCCEEDED", "NEEDS_REFUND"] } }, data: { mpesaReceipt: receipt } });
}
