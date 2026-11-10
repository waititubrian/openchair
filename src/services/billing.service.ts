import "server-only";
import { MPESA, PLANS, SUBSCRIPTION } from "@/lib/constants/business";
import type { SubscriptionPayment, Tenant } from "@/lib/domain";
import { ConflictError, ValidationError } from "@/lib/errors";
import { getMpesa, isMpesaConfigured } from "@/lib/mpesa";
import { failureReason } from "@/lib/mpesa-results";
import { assertCan } from "@/lib/permissions";
import { maskKenyanPhone, normalizeKenyanPhone } from "@/lib/phone";
import { hasProAccess, nextPeriodEnd, subscriptionState } from "@/lib/subscription";
import type { TenantContext } from "@/lib/tenant-context";
import * as staffRepo from "@/repositories/staff.repo";
import * as subscriptionPaymentRepo from "@/repositories/subscription-payment.repo";
import * as subscriptionRepo from "@/repositories/subscription.repo";
import * as tenantRepo from "@/repositories/tenant.repo";
import { runInTransaction, type Tx } from "@/repositories/transaction";
import type { Outcome } from "./payment.service";

// The Pro plan, paid for by the shop with M-Pesa. PREPAID: one payment buys SUBSCRIPTION.periodDays of
// Pro; renewing extends from the current end. M-Pesa can't auto-debit, so a shop renews by approving a
// prompt on its phone. After the period there is a short grace period, then the daily job downgrades it.
type Ctx = Pick<TenantContext, "tenantId" | "role" | "tenant">;
type CtxWithUser = Ctx & { user: { email: string } };

export async function getBillingSummary(ctx: Ctx, now: Date = new Date()) {
  assertCan(ctx, "billing:manage");
  const [sub, payments, pending] = await Promise.all([
    subscriptionRepo.findByTenant(ctx.tenantId),
    subscriptionPaymentRepo.listForTenant(ctx.tenantId, 10),
    subscriptionPaymentRepo.findLatestPending(ctx.tenantId),
  ]);
  const state = subscriptionState(sub, now);
  const plan = hasProAccess(state) ? ("PRO" as const) : ("FREE" as const);
  const promptFresh = pending && now.getTime() - pending.createdAt.getTime() < MPESA.promptExpiresAfterMinutes * 60_000;
  return {
    plan,
    planLabel: PLANS[plan].label,
    priceCents: PLANS.PRO.priceCentsPerMonth,
    periodDays: SUBSCRIPTION.periodDays,
    graceDays: SUBSCRIPTION.graceDays,
    state,
    mpesaConfigured: isMpesaConfigured(),
    waitingForPrompt: promptFresh ? { maskedPhone: maskKenyanPhone(pending.phone), sentAt: pending.createdAt } : null,
    payments: payments.map((p) => ({
      id: p.id,
      status: p.status,
      amountCents: p.amountCents,
      receipt: p.mpesaReceipt,
      failureReason: p.failureReason,
      periodEnd: p.periodEnd,
      createdAt: p.createdAt,
    })),
  };
}

/** Send the owner an M-Pesa prompt for one Pro period. OWNER only (billing:manage). */
export async function startSubscriptionPayment(ctx: CtxWithUser, rawPhone: string, now: Date = new Date()) {
  assertCan(ctx, "billing:manage");
  if (!isMpesaConfigured()) throw new ConflictError("M-Pesa payments aren't set up on this server yet.", "PAYMENTS_UNAVAILABLE");
  const phone = normalizeKenyanPhone(rawPhone);
  if (!phone) throw new ValidationError("Enter a Kenyan M-Pesa number like 0712 345 678.");

  const pending = await subscriptionPaymentRepo.findLatestPending(ctx.tenantId);
  if (pending && now.getTime() - pending.createdAt.getTime() < MPESA.minSecondsBetweenPrompts * 1000) {
    throw new ConflictError("A payment prompt was just sent. Check your phone and enter your M-Pesa PIN.", "PROMPT_RECENT");
  }

  const amountCents = PLANS.PRO.priceCentsPerMonth;
  const push = await (await getMpesa()).stkPush({ amountCents, phone, accountReference: "OPENCHAIRPRO", description: "Pro plan" });
  await subscriptionPaymentRepo.create(ctx.tenantId, {
    phone,
    amountCents,
    currency: ctx.tenant.currency,
    merchantRequestId: push.merchantRequestId,
    checkoutRequestId: push.checkoutRequestId,
    createdAt: now,
  });
  return { maskedPhone: maskKenyanPhone(phone), message: push.customerMessage };
}

export type SubscriptionSettlement = "activated" | "failed" | "already_processed";

/** Apply a VERIFIED M-Pesa result to a Pro payment (runs inside the caller's transaction). */
export async function settleSubscription(
  tenant: Tenant,
  payment: SubscriptionPayment,
  outcome: Outcome,
  now: Date,
  tx: Tx,
): Promise<SubscriptionSettlement> {
  if (outcome.kind === "failed") {
    const done = await subscriptionPaymentRepo.markFailed(tenant.id, payment.id, { resultCode: outcome.resultCode, resultDesc: outcome.resultDesc, reason: failureReason(outcome.resultCode) }, tx);
    return done ? "failed" : "already_processed";
  }
  if (outcome.amountCents !== null && outcome.amountCents !== payment.amountCents) {
    throw new Error(`Amount mismatch for ${payment.checkoutRequestId}: M-Pesa ${outcome.amountCents} vs ours ${payment.amountCents}`);
  }

  const existing = await subscriptionRepo.findByTenant(tenant.id, tx);
  const periodEnd = nextPeriodEnd(existing, now);
  // The guard on this UPDATE makes activation happen at most once per payment, however many paths report it.
  const won = await subscriptionPaymentRepo.markSucceeded(tenant.id, payment.id, { receipt: outcome.receipt, resultCode: outcome.resultCode, resultDesc: outcome.resultDesc, periodEnd }, tx);
  if (!won) return "already_processed";

  await subscriptionRepo.upsertPeriod(tenant.id, "PRO", periodEnd, tx);
  await tenantRepo.setPlan(tenant.id, "PRO", tx);
  return "activated";
}

/**
 * Daily job: shops whose paid period AND grace period have passed drop to Free. Their data is kept.
 * Free allows fewer active staff, so the extras (newest first) are deactivated, not deleted.
 */
export async function downgradeLapsedShops(now: Date = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - SUBSCRIPTION.graceDays * 86_400_000);
  const lapsed = await subscriptionRepo.listLapsed(cutoff);
  let downgraded = 0;
  for (const { tenantId } of lapsed) {
    await runInTransaction(async (tx) => {
      await tenantRepo.setPlan(tenantId, "FREE", tx);
      await staffRepo.deactivateAllButOldest(tenantId, PLANS.FREE.maxStaff, tx);
    });
    downgraded++;
  }
  return downgraded;
}
