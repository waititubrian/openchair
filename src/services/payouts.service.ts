import "server-only";
import { ConflictError, ForbiddenError, ValidationError } from "@/lib/errors";
import { assertCan } from "@/lib/permissions";
import { normalizeKenyanPhone } from "@/lib/phone";
import type { TenantContext } from "@/lib/tenant-context";
import * as paymentRepo from "@/repositories/payment.repo";
import * as payoutRepo from "@/repositories/payout.repo";
import * as tenantRepo from "@/repositories/tenant.repo";
import { runInTransaction } from "@/repositories/transaction";
import * as userRepo from "@/repositories/user.repo";
import { isMpesaConfigured } from "@/lib/mpesa";

// The PLATFORM COLLECTS deposits (customers pay the Openchair shortcode) and owes each shop what it
// collected minus the platform fee. This service shows a shop that balance and lets the platform admin
// record a payout against it.
//
//   balance owed = sum(successful deposits - platform fee) - sum(payouts already made)
//
// Real-world note: holding other businesses' money normally needs a payment-service licence (or a
// licensed aggregator doing the holding). This is a ledger for a demo/sandbox; see Architecture.md.
type Ctx = Pick<TenantContext, "tenantId" | "role" | "tenant">;

export async function getPayoutOverview(ctx: Ctx) {
  assertCan(ctx, "payouts:manage");
  const [collected, paidOutCents, recent, payouts, needsRefund] = await Promise.all([
    paymentRepo.sumCollected(ctx.tenantId),
    payoutRepo.sumPaidOut(ctx.tenantId),
    paymentRepo.listRecent(ctx.tenantId, 15),
    payoutRepo.listForTenant(ctx.tenantId, 10),
    paymentRepo.listNeedingRefund(ctx.tenantId),
  ]);
  const owedCents = collected.collectedCents - collected.feeCents;
  return {
    mpesaConfigured: isMpesaConfigured(),
    payoutPhone: ctx.tenant.payoutPhone,
    depositsOnline: isMpesaConfigured() && Boolean(ctx.tenant.payoutPhone),
    collectedCents: collected.collectedCents,
    feeCents: collected.feeCents,
    owedCents,
    paidOutCents,
    balanceCents: owedCents - paidOutCents,
    depositCount: collected.count,
    recent,
    payouts,
    needsRefundCount: needsRefund.length,
  };
}

/** Where the platform should send this shop's deposits. Turning it on is what enables online deposits. */
export async function setPayoutPhone(ctx: Ctx, rawPhone: string) {
  assertCan(ctx, "payouts:manage");
  const phone = normalizeKenyanPhone(rawPhone);
  if (!phone) throw new ValidationError("Enter a Kenyan M-Pesa number like 0712 345 678.");
  await tenantRepo.setPayoutPhone(ctx.tenantId, phone);
  return { payoutPhone: phone };
}

export async function clearPayoutPhone(ctx: Ctx) {
  assertCan(ctx, "payouts:manage");
  await tenantRepo.setPayoutPhone(ctx.tenantId, null);
}

/**
 * Platform admin only: record that money was sent to a shop. Cannot exceed what the shop is owed, and the
 * check and the insert happen under a per-shop lock so two payouts can't both claim the same balance.
 */
export async function recordPayout(
  actor: { id: string },
  input: { tenantId: string; amountCents: number; reference?: string | null; note?: string | null },
) {
  const user = await userRepo.findById(actor.id);
  if (user?.platformRole !== "PLATFORM_ADMIN") throw new ForbiddenError("Platform admins only");
  if (!Number.isInteger(input.amountCents) || input.amountCents <= 0 || input.amountCents % 100 !== 0) {
    throw new ValidationError("Payout amounts are whole shillings above zero.");
  }
  const tenant = await tenantRepo.findById(input.tenantId);
  if (!tenant?.payoutPhone) throw new ConflictError("This shop hasn't set a payout number.", "NO_PAYOUT_PHONE");

  return runInTransaction(async (tx) => {
    await payoutRepo.lockTenant(input.tenantId, tx);
    const [collected, paidOut] = await Promise.all([paymentRepo.sumCollected(input.tenantId, tx), payoutRepo.sumPaidOut(input.tenantId, tx)]);
    const balance = collected.collectedCents - collected.feeCents - paidOut;
    if (input.amountCents > balance) throw new ConflictError("That's more than the shop is owed.", "EXCEEDS_BALANCE");
    return payoutRepo.create(input.tenantId, { amountCents: input.amountCents, phone: tenant.payoutPhone!, reference: input.reference ?? null, note: input.note ?? null }, tx);
  });
}
