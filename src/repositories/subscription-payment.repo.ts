import "server-only";
import { dbOrTx, type Tx } from "./transaction";

// A shop paying for Pro by M-Pesa. Tenant-scoped, except findByCheckoutRequestId (callbacks identify
// the payment only by Safaricom's id; see payment.repo).

export function create(
  tenantId: string,
  data: { phone: string; amountCents: number; currency: string; merchantRequestId: string; checkoutRequestId: string; createdAt: Date },
  tx?: Tx,
) {
  return dbOrTx(tx).subscriptionPayment.create({ data: { ...data, tenantId, status: "PENDING" } });
}

export function findByCheckoutRequestId(checkoutRequestId: string, tx?: Tx) {
  return dbOrTx(tx).subscriptionPayment.findUnique({ where: { checkoutRequestId } });
}

export function listForTenant(tenantId: string, limit = 10, tx?: Tx) {
  return dbOrTx(tx).subscriptionPayment.findMany({ where: { tenantId }, orderBy: { createdAt: "desc" }, take: limit });
}

export function findLatestPending(tenantId: string, tx?: Tx) {
  return dbOrTx(tx).subscriptionPayment.findFirst({ where: { tenantId, status: "PENDING" }, orderBy: { createdAt: "desc" } });
}

export function listStalePending(olderThan: Date, tx?: Tx) {
  return dbOrTx(tx).subscriptionPayment.findMany({
    where: { status: "PENDING", createdAt: { lt: olderThan } },
    select: { id: true, tenantId: true, checkoutRequestId: true },
  });
}

export async function markSucceeded(
  tenantId: string,
  paymentId: string,
  result: { receipt: string | null; resultCode: number; resultDesc: string; periodEnd: Date },
  tx?: Tx,
) {
  const { count } = await dbOrTx(tx).subscriptionPayment.updateMany({
    where: { id: paymentId, tenantId, status: "PENDING" },
    data: { status: "SUCCEEDED", mpesaReceipt: result.receipt, resultCode: result.resultCode, resultDesc: result.resultDesc, periodEnd: result.periodEnd, failureReason: null },
  });
  return count > 0;
}

export async function markFailed(
  tenantId: string,
  paymentId: string,
  result: { resultCode: number; resultDesc: string; reason: string },
  tx?: Tx,
) {
  const { count } = await dbOrTx(tx).subscriptionPayment.updateMany({
    where: { id: paymentId, tenantId, status: "PENDING" },
    data: { status: "FAILED", resultCode: result.resultCode, resultDesc: result.resultDesc, failureReason: result.reason },
  });
  return count > 0;
}

export function touchQueried(tenantId: string, paymentId: string, at: Date, tx?: Tx) {
  return dbOrTx(tx).subscriptionPayment.updateMany({ where: { id: paymentId, tenantId }, data: { lastQueriedAt: at } });
}

export function setReceiptIfMissing(tenantId: string, paymentId: string, receipt: string, tx?: Tx) {
  return dbOrTx(tx).subscriptionPayment.updateMany({ where: { id: paymentId, tenantId, mpesaReceipt: null, status: "SUCCEEDED" }, data: { mpesaReceipt: receipt } });
}
