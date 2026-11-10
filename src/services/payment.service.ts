import "server-only";
import { MPESA, platformFeeCents } from "@/lib/constants/business";
import type { Payment, Tenant } from "@/lib/domain";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { getMpesa, isMpesaConfigured } from "@/lib/mpesa";
import { failureReason } from "@/lib/mpesa-results";
import { maskKenyanPhone, normalizeKenyanPhone } from "@/lib/phone";
import * as bookingRepo from "@/repositories/booking.repo";
import * as paymentRepo from "@/repositories/payment.repo";
import * as tenantRepo from "@/repositories/tenant.repo";
import type { Tx } from "@/repositories/transaction";

// Booking DEPOSITS paid by M-Pesa. The customer pays the PLATFORM's shortcode; the platform keeps
// its fee and owes the rest to the shop (see payouts.service). The M-Pesa prompt expires within a
// minute or two, so unlike a card checkout the "paid after the hold lapsed" case is rare, but it is
// still handled (revive the booking, or flag the payment for a manual refund).

export type Outcome =
  | { kind: "success"; resultCode: number; resultDesc: string; receipt: string | null; amountCents: number | null }
  | { kind: "failed"; resultCode: number; resultDesc: string };

export type DepositSettlement = "confirmed" | "revived" | "needs_refund" | "already_confirmed" | "already_processed" | "failed";

/** A shop can take deposits online when M-Pesa is configured AND it has said where to send the money. */
export const depositsOnline = (tenant: Pick<Tenant, "payoutPhone">) => isMpesaConfigured() && Boolean(tenant.payoutPhone);

// ---- sending the prompt --------------------------------------------------------------------------

/**
 * Send an M-Pesa prompt to the customer's phone for a booking that is waiting for its deposit.
 * Safe to call again (a lost prompt, a wrong number): prompts are rate-limited per booking.
 */
export async function startDepositPayment(slug: string, publicToken: string, rawPhone: string, now: Date = new Date()) {
  const tenant = await tenantRepo.findBySlug(slug);
  if (!tenant) throw new NotFoundError("Shop");
  const found = await bookingRepo.findIdByPublicToken(tenant.id, publicToken);
  if (!found) throw new NotFoundError("Booking");
  const booking = await bookingRepo.findForPayment(tenant.id, found.id);
  if (!booking) throw new NotFoundError("Booking");

  if (booking.status !== "PENDING_PAYMENT") throw new ConflictError("This booking doesn't need a payment.", "NOT_PENDING");
  if (booking.holdExpiresAt && booking.holdExpiresAt < now) {
    throw new ConflictError("Your time was released because the deposit wasn't paid in time. Please book again.", "HOLD_EXPIRED");
  }
  if (!depositsOnline(tenant)) throw new ConflictError("This shop can't take M-Pesa payments right now.", "PAYMENTS_UNAVAILABLE");

  const phone = normalizeKenyanPhone(rawPhone);
  if (!phone) throw new ValidationError("Enter a Kenyan M-Pesa number like 0712 345 678.");

  const attempts = await paymentRepo.listForBooking(tenant.id, booking.id);
  if (attempts.length >= MPESA.maxPromptsPerBooking) {
    throw new ConflictError("Too many payment attempts for this booking. Please contact the shop.", "TOO_MANY_PROMPTS");
  }
  const last = attempts.at(-1);
  if (last?.status === "PENDING" && now.getTime() - last.createdAt.getTime() < MPESA.minSecondsBetweenPrompts * 1000) {
    throw new ConflictError("A payment prompt was just sent. Check your phone and enter your M-Pesa PIN.", "PROMPT_RECENT");
  }

  const push = await (await getMpesa()).stkPush({
    amountCents: booking.depositCents,
    phone,
    accountReference: `OC${booking.id.slice(-8).toUpperCase()}`,
    description: "Deposit",
  });
  await paymentRepo.create(tenant.id, {
    bookingId: booking.id,
    phone,
    amountCents: booking.depositCents,
    applicationFeeCents: platformFeeCents(booking.depositCents),
    currency: tenant.currency,
    merchantRequestId: push.merchantRequestId,
    checkoutRequestId: push.checkoutRequestId,
    createdAt: now,
  });
  return { maskedPhone: maskKenyanPhone(phone), message: push.customerMessage };
}

// ---- settling a verified result -------------------------------------------------------------------

/**
 * Apply a VERIFIED M-Pesa result to a deposit and its booking. Runs in the caller's transaction, so the
 * payment and booking change together.
 *
 *   success, booking still waiting        -> CONFIRMED
 *   success, hold lapsed, slot still free -> booking REVIVED and CONFIRMED
 *   success, slot taken / shop cancelled  -> payment flagged NEEDS_REFUND (a person returns it)
 *   success, but already paid before      -> the duplicate is flagged NEEDS_REFUND
 *   failure (cancelled, no funds, ...)    -> payment FAILED; the booking keeps its hold so the customer can retry
 */
export async function settleDeposit(tenant: Tenant, payment: Payment, outcome: Outcome, tx: Tx): Promise<DepositSettlement> {
  if (outcome.kind === "failed") {
    const done = await paymentRepo.markFailed(tenant.id, payment.id, { resultCode: outcome.resultCode, resultDesc: outcome.resultDesc, reason: failureReason(outcome.resultCode) }, tx);
    return done ? "failed" : "already_processed";
  }

  if (outcome.amountCents !== null && outcome.amountCents !== payment.amountCents) {
    // Never confirm a booking on an amount we didn't ask for.
    throw new Error(`Amount mismatch for ${payment.checkoutRequestId}: M-Pesa ${outcome.amountCents} vs ours ${payment.amountCents}`);
  }
  // The status guard in this UPDATE means exactly one of two racing callers (callback vs status poll) wins.
  const won = await paymentRepo.markSucceeded(tenant.id, payment.id, { receipt: outcome.receipt, resultCode: outcome.resultCode, resultDesc: outcome.resultDesc }, tx);
  if (!won) return "already_processed";

  const booking = await bookingRepo.findForPayment(tenant.id, payment.bookingId, tx);
  if (!booking) return "needs_refund";

  const flag = async (why: string) => {
    await paymentRepo.markNeedsRefund(tenant.id, payment.id, why, tx);
    return "needs_refund" as const;
  };

  // A second successful payment for one booking (e.g. two prompts both approved): keep the first.
  const siblings = await paymentRepo.listForBooking(tenant.id, payment.bookingId, tx);
  if (siblings.some((p) => p.id !== payment.id && p.status === "SUCCEEDED")) return flag("duplicate_payment");

  switch (booking.status) {
    case "PENDING_PAYMENT":
      await bookingRepo.confirmPending(tenant.id, booking.id, tx);
      return "confirmed";
    case "CANCELLED": {
      const released = booking.cancelReason === "hold_expired" || booking.cancelReason === "payment_expired";
      if (released && (await bookingRepo.reviveExpired(tenant.id, booking.id, tx))) return "revived";
      return flag(released ? "slot_taken" : "booking_cancelled");
    }
    default:
      return "already_confirmed"; // CONFIRMED / COMPLETED / NO_SHOW: the deposit stands
  }
}
