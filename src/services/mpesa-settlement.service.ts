import "server-only";
import { MPESA } from "@/lib/constants/business";
import type { Payment, SubscriptionPayment, Tenant } from "@/lib/domain";
import { MpesaError, ValidationError } from "@/lib/errors";
import { getMpesa } from "@/lib/mpesa";
import * as bookingRepo from "@/repositories/booking.repo";
import * as paymentRepo from "@/repositories/payment.repo";
import * as subscriptionPaymentRepo from "@/repositories/subscription-payment.repo";
import * as tenantRepo from "@/repositories/tenant.repo";
import { runInTransaction } from "@/repositories/transaction";
import * as webhookRepo from "@/repositories/webhook-event.repo";
import { callbackDetails, stkCallbackBody } from "@/validators/mpesa";
import * as billingService from "./billing.service";
import * as paymentService from "./payment.service";
import type { Outcome } from "./payment.service";

// Where an M-Pesa result becomes a booking confirmation or a Pro subscription. Three paths lead here
// and they all end in the same idempotent step:
//   1. Safaricom's CALLBACK (asynchronous, UNSIGNED),
//   2. a status POLL while the customer is looking at the page,
//   3. the scheduled sweep.
//
// Because callbacks are not signed, nothing is believed just because a callback said so. The callback
// only tells us WHERE to look: we ask Safaricom's status-query API about that CheckoutRequestID (which
// must be a prompt we ourselves sent) and act on THAT answer. A forged callback therefore cannot
// confirm a booking or grant Pro.

export type SettlementOutcome = "processed" | "duplicate" | "ignored" | "pending";

type Pending =
  | { kind: "deposit"; row: Payment }
  | { kind: "subscription"; row: SubscriptionPayment };

/** Callbacks identify the payment only by Safaricom's CheckoutRequestID. */
async function findByCheckoutRequestId(checkoutRequestId: string): Promise<Pending | null> {
  const deposit = await paymentRepo.findByCheckoutRequestId(checkoutRequestId);
  if (deposit) return { kind: "deposit", row: deposit };
  const sub = await subscriptionPaymentRepo.findByCheckoutRequestId(checkoutRequestId);
  return sub ? { kind: "subscription", row: sub } : null;
}

/** Ask Safaricom for the real answer (never trust a callback body on its own). */
async function verify(checkoutRequestId: string) {
  return (await getMpesa()).stkQuery(checkoutRequestId);
}

/**
 * Apply a verified outcome exactly once: claim the event in the ledger (same transaction as the
 * effects), then settle. A duplicate claim means another path already handled it.
 */
async function settle(pending: Pending, outcome: Outcome, now: Date): Promise<SettlementOutcome> {
  const checkoutRequestId = pending.row.checkoutRequestId!;
  const entry = {
    id: `mpesa:${checkoutRequestId}`,
    source: "mpesa",
    type: pending.kind === "deposit" ? "stk.deposit" : "stk.subscription",
    payload: { checkoutRequestId, kind: pending.kind, resultCode: outcome.resultCode, ok: outcome.kind === "success" ? 1 : 0 },
  };
  try {
    return await runInTransaction(async (tx) => {
      const claimed = await webhookRepo.claim(entry, tx);
      if (!claimed) {
        const existing = await webhookRepo.findById(entry.id, tx);
        if (existing?.processedAt) return "duplicate" as const;
      }
      const tenant = (await tenantRepo.findById(pending.row.tenantId, tx)) as Tenant;
      if (pending.kind === "deposit") await paymentService.settleDeposit(tenant, pending.row, outcome, tx);
      else await billingService.settleSubscription(tenant, pending.row, outcome, now, tx);
      await webhookRepo.markProcessed(entry.id, tx);
      return "processed" as const;
    });
  } catch (e) {
    await webhookRepo.recordFailure(entry, e instanceof Error ? e.message : String(e)).catch(() => {});
    throw e;
  }
}

// ---- path 1: the callback ------------------------------------------------------------------------------

/**
 * Handle Safaricom's STK callback. Returns what happened; the route always answers 200 so Safaricom
 * doesn't retry (a failure is recorded in the ledger and reconciled by polling or the sweep).
 */
export async function handleStkCallback(rawBody: unknown, now: Date = new Date()): Promise<SettlementOutcome> {
  const parsed = stkCallbackBody.safeParse(rawBody);
  if (!parsed.success) throw new ValidationError("Not an STK callback");
  const cb = parsed.data.Body.stkCallback;
  const details = callbackDetails(parsed.data);

  const pending = await findByCheckoutRequestId(cb.CheckoutRequestID);
  if (!pending) return "ignored"; // a prompt we never sent: someone is guessing

  if (pending.row.status !== "PENDING") {
    // Already settled (usually by a status poll). The poll can't know the receipt, so the callback fills it in.
    if (details.receipt && cb.ResultCode === 0) await fillReceipt(pending, details.receipt);
    return "duplicate";
  }

  let answer;
  try {
    answer = await verify(cb.CheckoutRequestID);
  } catch (e) {
    if (e instanceof MpesaError) return "pending"; // can't verify right now; polling/sweep will resolve it
    throw e;
  }
  if (answer.status === "pending") return "pending";

  // Trust the status query for success/failure. The receipt number exists only in the callback.
  const outcome: Outcome =
    answer.status === "success"
      ? { kind: "success", resultCode: answer.resultCode, resultDesc: answer.resultDesc, receipt: cb.ResultCode === 0 ? details.receipt : null, amountCents: cb.ResultCode === 0 ? details.amountCents : null }
      : { kind: "failed", resultCode: answer.resultCode, resultDesc: answer.resultDesc };
  try {
    return await settle(pending, outcome, now);
  } catch (e) {
    // Already recorded in the ledger by settle(). Safaricom must still get a 200 (it would otherwise retry
    // the same callback in a loop); the payment stays PENDING for a person to review via the ledger error.
    console.error("could not settle an M-Pesa callback", e);
    return "pending";
  }
}

async function fillReceipt(pending: Pending, receipt: string) {
  if (pending.kind === "deposit") await paymentRepo.setReceiptIfMissing(pending.row.tenantId, pending.row.id, receipt);
  else await subscriptionPaymentRepo.setReceiptIfMissing(pending.row.tenantId, pending.row.id, receipt);
}

// ---- path 2 and 3: polling and the sweep ---------------------------------------------------------------

/** Ask Safaricom about a prompt and settle it if it has an answer (or has gone unanswered too long). */
async function reconcile(pending: Pending, now: Date): Promise<SettlementOutcome> {
  const { row } = pending;
  if (row.status !== "PENDING" || !row.checkoutRequestId) return "duplicate";
  // Don't hammer Daraja: one query per few seconds per payment, however many tabs are polling.
  if (row.lastQueriedAt && now.getTime() - row.lastQueriedAt.getTime() < 4000) return "pending";
  if (pending.kind === "deposit") await paymentRepo.touchQueried(row.tenantId, row.id, now);
  else await subscriptionPaymentRepo.touchQueried(row.tenantId, row.id, now);

  let answer;
  try {
    answer = await verify(row.checkoutRequestId);
  } catch (e) {
    if (e instanceof MpesaError) return "pending";
    throw e;
  }
  if (answer.status === "pending") {
    const expired = now.getTime() - row.createdAt.getTime() > MPESA.promptExpiresAfterMinutes * 60_000;
    return expired ? settle(pending, { kind: "failed", resultCode: 1037, resultDesc: "No response from the customer's phone" }, now) : "pending";
  }
  const outcome: Outcome =
    answer.status === "success"
      ? { kind: "success", resultCode: answer.resultCode, resultDesc: answer.resultDesc, receipt: null, amountCents: null }
      : { kind: "failed", resultCode: answer.resultCode, resultDesc: answer.resultDesc };
  return settle(pending, outcome, now);
}

/** The confirmation page polls this while a customer's prompt is outstanding. */
export async function reconcileBookingDeposit(slug: string, publicToken: string, now: Date = new Date()): Promise<void> {
  const tenant = await tenantRepo.findBySlug(slug);
  if (!tenant) return;
  const found = await bookingRepo.findIdByPublicToken(tenant.id, publicToken);
  if (!found) return;
  const latest = (await paymentRepo.listForBooking(tenant.id, found.id)).filter((p) => p.status === "PENDING").at(-1);
  if (latest) await reconcile({ kind: "deposit", row: latest }, now);
}

/** The billing page polls this while the owner's Pro prompt is outstanding. */
export async function reconcileSubscriptionPayment(tenantId: string, now: Date = new Date()): Promise<void> {
  const latest = await subscriptionPaymentRepo.findLatestPending(tenantId);
  if (latest) await reconcile({ kind: "subscription", row: latest }, now);
}

/** Scheduled sweep: settle (or expire) every prompt that has been waiting too long. */
export async function sweepStalePrompts(now: Date = new Date()) {
  const olderThan = new Date(now.getTime() - 60_000); // give a fresh prompt a minute before asking
  const [deposits, subs] = await Promise.all([paymentRepo.listStalePending(olderThan), subscriptionPaymentRepo.listStalePending(olderThan)]);
  let settled = 0;
  for (const row of deposits) {
    const full = await paymentRepo.findByCheckoutRequestId(row.checkoutRequestId!);
    if (full && (await reconcile({ kind: "deposit", row: { ...full, lastQueriedAt: null } }, now)) === "processed") settled++;
  }
  for (const row of subs) {
    const full = await subscriptionPaymentRepo.findByCheckoutRequestId(row.checkoutRequestId!);
    if (full && (await reconcile({ kind: "subscription", row: { ...full, lastQueriedAt: null } }, now)) === "processed") settled++;
  }
  return settled;
}
