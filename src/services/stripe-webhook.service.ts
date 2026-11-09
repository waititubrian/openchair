import "server-only";
import type Stripe from "stripe";
import { env } from "@/lib/env";
import { AppError } from "@/lib/errors";
import { constructWebhookEvent } from "@/lib/stripe";
import * as tenantRepo from "@/repositories/tenant.repo";
import { runInTransaction, type Tx } from "@/repositories/transaction";
import * as webhookRepo from "@/repositories/webhook-event.repo";
import type { LedgerEntry } from "@/repositories/webhook-event.repo";
import * as paymentService from "./payment.service";
import * as payoutsService from "./payouts.service";

// Stripe webhooks for CONNECTED accounts (deposit payments and onboarding status).
// Three guarantees:
//   1. AUTHENTIC: the signature is verified against the raw body before anything is read.
//   2. IDEMPOTENT: the event id is claimed in the WebhookEvent table in the SAME transaction as the
//      effects, so a replayed or simultaneous duplicate can never apply twice. A failure rolls
//      everything back, so Stripe's retry starts clean.
//   3. SCOPED: an event only ever touches the shop that owns `event.account`.

export class WebhookSignatureError extends AppError {
  constructor() {
    super("Invalid webhook signature", "INVALID_SIGNATURE", 400);
  }
}

export type WebhookOutcome = "processed" | "duplicate" | "ignored";

/** Verify, then process. `rawBody` must be the exact bytes Stripe sent (not re-serialised JSON). */
export async function handleConnectWebhook(rawBody: string, signature: string | null, now: Date = new Date()) {
  const secret = env.STRIPE_CONNECT_WEBHOOK_SECRET;
  if (!secret) throw new AppError("Stripe webhooks are not configured on this server", "WEBHOOK_NOT_CONFIGURED", 503);
  if (!signature) throw new WebhookSignatureError();
  let event: Stripe.Event;
  try {
    event = constructWebhookEvent(rawBody, signature, secret);
  } catch {
    throw new WebhookSignatureError();
  }
  return { outcome: await processEvent(event, now) };
}

/** What we keep of an event: enough to audit, no customer details (names, emails) from the payload. */
function ledgerEntry(event: Stripe.Event): LedgerEntry {
  const object = event.data.object as { id?: string };
  const payload = { id: event.id, type: event.type, account: event.account ?? null, created: event.created, objectId: object?.id ?? null };
  return { id: event.id, source: "connect", type: event.type, payload };
}

async function processEvent(event: Stripe.Event, now: Date): Promise<WebhookOutcome> {
  const entry = ledgerEntry(event);
  try {
    return await runInTransaction(
      async (tx) => {
        const claimed = await webhookRepo.claim(entry, tx);
        if (!claimed) {
          const existing = await webhookRepo.findById(event.id, tx);
          if (existing?.processedAt) return "duplicate" as const; // already handled: acknowledge, do nothing
          // otherwise an earlier attempt failed and was rolled back: process it now
        }
        const outcome = await dispatch(event, now, tx);
        await webhookRepo.markProcessed(event.id, tx);
        return outcome;
      },
      { timeoutMs: 20_000 }, // a refund call may happen inside
    );
  } catch (e) {
    // The transaction rolled back (so no half-applied effects). Make the failure visible, then let
    // the error reach the route, which answers 500 so Stripe retries.
    await webhookRepo.recordFailure(entry, e instanceof Error ? e.message : String(e)).catch(() => {});
    throw e;
  }
}

async function dispatch(event: Stripe.Event, now: Date, tx: Tx): Promise<WebhookOutcome> {
  if (!event.account) return "ignored"; // platform-level events belong to the other endpoint (Phase 6)
  const tenant = await tenantRepo.findByStripeAccountId(event.account, tx);
  if (!tenant) return "ignored"; // an account we don't know

  switch (event.type) {
    case "account.updated": {
      const account = event.data.object;
      if (account.id !== event.account) return "ignored";
      await payoutsService.applyAccountState(account, tx);
      return "processed";
    }
    case "checkout.session.completed":
    case "checkout.session.async_payment_succeeded": {
      const session = event.data.object;
      if (session.payment_status !== "paid") return "ignored"; // e.g. a delayed method still pending
      await paymentService.applyPaidSession(tenant, session, tx);
      return "processed";
    }
    case "checkout.session.expired":
      await paymentService.applyExpiredSession(tenant, event.data.object, now, tx);
      return "processed";
    case "payment_intent.payment_failed":
      await paymentService.applyPaymentFailed(tenant, event.data.object, tx);
      return "processed";
    default:
      return "ignored"; // recorded in the ledger, nothing to do
  }
}
