import "server-only";
import type Stripe from "stripe";
import { CHECKOUT_SESSION_MINUTES, MIN_DEPOSIT_CENTS, platformFeeCents } from "@/lib/constants/business";
import type { Tenant } from "@/lib/domain";
import { env } from "@/lib/env";
import { ConflictError, NotFoundError } from "@/lib/errors";
import { getStripe, isStripeConfigured } from "@/lib/stripe";
import * as bookingRepo from "@/repositories/booking.repo";
import * as paymentRepo from "@/repositories/payment.repo";
import * as tenantRepo from "@/repositories/tenant.repo";
import { runInTransaction, type Tx } from "@/repositories/transaction";

// Deposit payments: the customer pays the SHOP's connected Stripe account directly (a "direct
// charge") and the platform keeps an application fee. Stripe webhooks are the source of truth for
// whether money arrived; this service holds the logic both the webhook and the return-page
// reconciliation share, so the two can never disagree.

export type PaidOutcome = "confirmed" | "revived" | "refunded" | "already_processed" | "already_confirmed" | "ignored";

// ---- starting a payment ------------------------------------------------------------------------

/**
 * Create (or reuse) a Stripe Checkout Session for a booking that is waiting for its deposit and
 * return the hosted payment page URL.
 */
export async function startDepositCheckout(slug: string, publicToken: string, now: Date = new Date()): Promise<{ url: string }> {
  const tenant = await tenantRepo.findBySlug(slug);
  if (!tenant) throw new NotFoundError("Shop");
  const found = await bookingRepo.findIdByPublicToken(tenant.id, publicToken);
  if (!found) throw new NotFoundError("Booking");
  const booking = await bookingRepo.findForPayment(tenant.id, found.id);
  if (!booking) throw new NotFoundError("Booking");

  if (booking.status !== "PENDING_PAYMENT") {
    throw new ConflictError("This booking doesn't need a payment.", "NOT_PENDING");
  }
  if (booking.holdExpiresAt && booking.holdExpiresAt < now) {
    throw new ConflictError("Your time was released because the deposit wasn't paid in time. Please book again.", "HOLD_EXPIRED");
  }
  if (!isStripeConfigured() || !tenant.stripeAccountId || !tenant.chargesEnabled || booking.depositCents < MIN_DEPOSIT_CENTS) {
    throw new ConflictError("This shop can't take card payments right now.", "PAYMENTS_UNAVAILABLE");
  }

  const stripe = getStripe();
  const options = { stripeAccount: tenant.stripeAccountId };
  const payments = await paymentRepo.listForBooking(tenant.id, booking.id);

  // Reuse a session the customer already has open (back button, a second click, a retry).
  const open = payments.filter((p) => p.status === "PENDING").at(-1);
  if (open) {
    const existing = await stripe.checkout.sessions.retrieve(open.stripeCheckoutSessionId, undefined, options);
    if (existing.status === "open" && existing.url) return { url: existing.url };
  }

  const fee = platformFeeCents(booking.depositCents);
  const confirmation = `${env.APP_URL}/b/${tenant.slug}/confirmation/${booking.publicToken}`;
  const session = await stripe.checkout.sessions.create(
    {
      mode: "payment",
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: tenant.currency,
            unit_amount: booking.depositCents,
            product_data: { name: `Deposit: ${booking.service.name}`, description: tenant.name },
          },
        },
      ],
      // The platform's cut of the deposit. The rest goes to the shop's own Stripe account.
      payment_intent_data: { application_fee_amount: fee, metadata: { bookingId: booking.id, tenantId: tenant.id } },
      customer_email: booking.customer.email,
      client_reference_id: booking.id,
      metadata: { bookingId: booking.id, tenantId: tenant.id },
      success_url: `${confirmation}?paid=1`,
      cancel_url: `${confirmation}?canceled=1`,
      // Stripe's minimum lifetime is 30 minutes, longer than our hold: late payments are handled below.
      expires_at: Math.floor(now.getTime() / 1000) + CHECKOUT_SESSION_MINUTES * 60,
    },
    // One session per booking attempt, even if the request is retried.
    { ...options, idempotencyKey: `checkout_${booking.id}_${payments.length}` },
  );
  if (!session.url) throw new Error("Stripe returned a Checkout Session without a URL");

  await paymentRepo.create(tenant.id, {
    bookingId: booking.id,
    stripeCheckoutSessionId: session.id,
    amountCents: booking.depositCents,
    applicationFeeCents: fee,
    currency: tenant.currency,
  });
  return { url: session.url };
}

// ---- applying Stripe's verdict (shared by the webhook and the return-page check) ------------------

async function refund(tenant: Tenant, payment: { id: string }, paymentIntentId: string | null, tx: Tx) {
  if (!paymentIntentId || !tenant.stripeAccountId) throw new Error("Cannot refund: missing payment intent or account");
  // Idempotent: replays of the same event return the same refund instead of refunding twice.
  await getStripe().refunds.create(
    { payment_intent: paymentIntentId, refund_application_fee: true },
    { stripeAccount: tenant.stripeAccountId, idempotencyKey: `refund_${payment.id}` },
  );
  await paymentRepo.markRefunded(tenant.id, payment.id, tx);
}

const paymentIntentIdOf = (s: Stripe.Checkout.Session) =>
  typeof s.payment_intent === "string" ? s.payment_intent : (s.payment_intent?.id ?? null);

/**
 * Money arrived for a Checkout Session. Decide what that means for the booking:
 *   still waiting            -> CONFIRMED
 *   hold lapsed, slot free   -> revived and CONFIRMED
 *   hold lapsed, slot taken  -> refund (the customer is never charged for a time they can't have)
 *   already paid before      -> nothing (idempotent), or refund if this is a SECOND payment
 * Runs inside the caller's transaction, so the ledger row, payment and booking change together.
 */
export async function applyPaidSession(tenant: Tenant, session: Stripe.Checkout.Session, tx: Tx): Promise<PaidOutcome> {
  const bookingId = session.metadata?.bookingId;
  if (!bookingId) return "ignored"; // not one of ours
  const booking = await bookingRepo.findForPayment(tenant.id, bookingId, tx); // scoped: another shop's booking is invisible
  if (!booking) return "ignored";

  let payment = await paymentRepo.findBySessionId(tenant.id, session.id, tx);
  if (!payment) {
    // The session was created but we crashed before saving the Payment row: rebuild it from Stripe.
    const amount = session.amount_total ?? 0;
    payment = await paymentRepo.create(
      tenant.id,
      { bookingId, stripeCheckoutSessionId: session.id, amountCents: amount, applicationFeeCents: platformFeeCents(amount), currency: session.currency ?? tenant.currency },
      tx,
    );
  }
  if (payment.status === "SUCCEEDED" || payment.status === "REFUNDED") return "already_processed";
  if (session.amount_total !== payment.amountCents) {
    throw new Error(`Amount mismatch for ${session.id}: Stripe ${session.amount_total} vs ours ${payment.amountCents}`);
  }

  const paymentIntentId = paymentIntentIdOf(session);
  // The status guard in this UPDATE means exactly one of two racing callers (webhook vs return page) wins.
  if (!(await paymentRepo.markSucceeded(tenant.id, payment.id, paymentIntentId, tx))) return "already_processed";

  // Two successful payments for one booking (e.g. paid in two tabs): keep the first, refund this one.
  const siblings = await paymentRepo.listForBooking(tenant.id, bookingId, tx);
  if (siblings.some((p) => p.id !== payment.id && p.status === "SUCCEEDED")) {
    await refund(tenant, payment, paymentIntentId, tx);
    return "refunded";
  }

  switch (booking.status) {
    case "PENDING_PAYMENT":
      await bookingRepo.confirmPending(tenant.id, bookingId, tx);
      return "confirmed";
    case "CANCELLED": {
      const released = booking.cancelReason === "hold_expired" || booking.cancelReason === "payment_expired";
      if (released && (await bookingRepo.reviveExpired(tenant.id, bookingId, tx))) return "revived";
      await refund(tenant, payment, paymentIntentId, tx); // slot taken, or the shop cancelled it
      return "refunded";
    }
    default:
      return "already_confirmed"; // CONFIRMED / COMPLETED / NO_SHOW: the deposit stands
  }
}

/** The Checkout Session expired unpaid: release the slot unless the customer has another session open. */
export async function applyExpiredSession(tenant: Tenant, session: Stripe.Checkout.Session, now: Date, tx: Tx): Promise<void> {
  const bookingId = session.metadata?.bookingId;
  if (!bookingId) return;
  const payment = await paymentRepo.findBySessionId(tenant.id, session.id, tx);
  if (!payment) return;
  await paymentRepo.markFailed(tenant.id, payment.id, "checkout_expired", tx);
  const others = (await paymentRepo.listForBooking(tenant.id, bookingId, tx)).filter(
    (p) => p.id !== payment.id && p.status === "PENDING",
  );
  if (others.length === 0) await bookingRepo.cancelPending(tenant.id, bookingId, "payment_expired", now, tx);
}

/** A card attempt failed. The session stays open (the customer can try another card): record why. */
export async function applyPaymentFailed(tenant: Tenant, intent: Stripe.PaymentIntent, tx: Tx): Promise<void> {
  const bookingId = intent.metadata?.bookingId;
  if (!bookingId) return;
  const pending = (await paymentRepo.listForBooking(tenant.id, bookingId, tx)).filter((p) => p.status === "PENDING").at(-1);
  if (!pending) return;
  const reason = intent.last_payment_error?.message ?? intent.last_payment_error?.code ?? "payment_failed";
  await paymentRepo.noteFailureReason(tenant.id, pending.id, reason, tx);
}

// ---- return-page safety net ----------------------------------------------------------------------

/**
 * When the customer lands back from Stripe the webhook may not have arrived yet. Ask Stripe
 * directly and apply the same logic. The webhook remains the source of truth: whichever arrives
 * second finds the payment already processed and does nothing.
 */
export async function reconcileBooking(slug: string, publicToken: string): Promise<void> {
  const tenant = await tenantRepo.findBySlug(slug);
  if (!tenant?.stripeAccountId || !isStripeConfigured()) return;
  const found = await bookingRepo.findIdByPublicToken(tenant.id, publicToken);
  if (!found) return;
  const pending = (await paymentRepo.listForBooking(tenant.id, found.id)).filter((p) => p.status === "PENDING").at(-1);
  if (!pending) return;

  const session = await getStripe().checkout.sessions.retrieve(pending.stripeCheckoutSessionId, undefined, {
    stripeAccount: tenant.stripeAccountId,
  });
  if (session.payment_status === "paid") {
    await runInTransaction((tx) => applyPaidSession(tenant, session, tx), { timeoutMs: 20_000 });
  }
}
