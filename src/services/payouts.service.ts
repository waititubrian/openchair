import "server-only";
import type Stripe from "stripe";
import { CONNECT_COUNTRY } from "@/lib/constants/business";
import { env } from "@/lib/env";
import { ConflictError, ValidationError } from "@/lib/errors";
import { assertCan } from "@/lib/permissions";
import { getStripe, isStripeConfigured } from "@/lib/stripe";
import type { TenantContext } from "@/lib/tenant-context";
import * as tenantRepo from "@/repositories/tenant.repo";
import type { Tx } from "@/repositories/transaction";

// Payouts = the shop's Stripe Connect (Express) account: where customer deposits are paid out to.
// OWNER only (payouts:manage). Stripe hosts the onboarding; we only create the account, send the
// owner there, and mirror its status (charges/payouts enabled, what is still due).
type Ctx = Pick<TenantContext, "tenantId" | "role" | "tenant">;
type CtxWithUser = Ctx & { user: { email: string } };

function requireStripe() {
  if (!isStripeConfigured()) throw new ValidationError("Card payments aren't configured on this server yet.");
}

export async function getPayoutStatus(ctx: Ctx) {
  assertCan(ctx, "payouts:manage");
  const t = ctx.tenant;
  return {
    stripeConfigured: isStripeConfigured(),
    connected: Boolean(t.stripeAccountId),
    detailsSubmitted: t.detailsSubmitted,
    chargesEnabled: t.chargesEnabled,
    payoutsEnabled: t.payoutsEnabled,
    requirementsDue: t.stripeRequirementsDue,
  };
}

/** Mirror a Stripe account's state onto our tenant row (used by the webhook and by "refresh status"). */
export async function applyAccountState(account: Stripe.Account, tx?: Tx) {
  await tenantRepo.updateStripeState(
    account.id,
    {
      chargesEnabled: Boolean(account.charges_enabled),
      payoutsEnabled: Boolean(account.payouts_enabled),
      detailsSubmitted: Boolean(account.details_submitted),
      requirementsDue: account.requirements?.currently_due ?? [],
    },
    tx,
  );
}

const returnUrls = () => ({
  refresh_url: `${env.APP_URL}/dashboard/payouts/refresh`,
  return_url: `${env.APP_URL}/dashboard/payouts/return`,
});

/**
 * Create the shop's Express account if it doesn't have one, then return a one-time onboarding
 * link. Safe to call repeatedly or concurrently: the Stripe idempotency key makes account creation
 * return the SAME account, and we never overwrite an id that is already stored.
 */
export async function startOnboarding(ctx: CtxWithUser): Promise<{ url: string }> {
  assertCan(ctx, "payouts:manage");
  requireStripe();
  const stripe = getStripe();

  let accountId = ctx.tenant.stripeAccountId;
  if (!accountId) {
    const account = await stripe.accounts.create(
      {
        type: "express",
        country: CONNECT_COUNTRY,
        email: ctx.user.email,
        business_profile: { name: ctx.tenant.name },
        capabilities: { card_payments: { requested: true }, transfers: { requested: true } },
        metadata: { tenantId: ctx.tenantId },
      },
      { idempotencyKey: `connect_account_${ctx.tenantId}` },
    );
    await tenantRepo.setStripeAccountId(ctx.tenantId, account.id);
    accountId = (await tenantRepo.findById(ctx.tenantId))?.stripeAccountId ?? account.id;
  }

  const link = await stripe.accountLinks.create({ account: accountId, type: "account_onboarding", ...returnUrls() });
  return { url: link.url };
}

/** After the owner returns from Stripe (which does NOT mean onboarding is complete): re-read the account. */
export async function refreshStatus(ctx: Ctx): Promise<void> {
  assertCan(ctx, "payouts:manage");
  if (!ctx.tenant.stripeAccountId) return;
  requireStripe();
  await applyAccountState(await getStripe().accounts.retrieve(ctx.tenant.stripeAccountId));
}

/** Link to the shop's own Stripe Express dashboard (balance, payouts, payments). */
export async function createDashboardLink(ctx: Ctx): Promise<{ url: string }> {
  assertCan(ctx, "payouts:manage");
  requireStripe();
  if (!ctx.tenant.stripeAccountId || !ctx.tenant.detailsSubmitted) {
    throw new ConflictError("Finish setting up payouts first.", "ONBOARDING_INCOMPLETE");
  }
  const link = await getStripe().accounts.createLoginLink(ctx.tenant.stripeAccountId);
  return { url: link.url };
}
