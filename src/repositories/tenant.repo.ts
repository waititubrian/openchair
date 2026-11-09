import "server-only";
import { dbOrTx, type Tx } from "./transaction";

// Tenant is the root of tenancy, so these two lookups are necessarily keyed by slug / id
// rather than "scoped by tenantId". They are the entry points that PRODUCE a tenantId.
// Every other repository method takes tenantId as its first argument.

export function findBySlug(slug: string, tx?: Tx) {
  return dbOrTx(tx).tenant.findUnique({ where: { slug } });
}

export function findById(tenantId: string, tx?: Tx) {
  return dbOrTx(tx).tenant.findUnique({ where: { id: tenantId } });
}

export async function slugExists(slug: string, tx?: Tx): Promise<boolean> {
  return (await dbOrTx(tx).tenant.count({ where: { slug } })) > 0;
}

export function create(
  data: { slug: string; name: string; timezone: string; depositHoldMinutes: number },
  tx?: Tx,
) {
  return dbOrTx(tx).tenant.create({ data });
}

export async function update(tenantId: string, data: { name?: string; timezone?: string }, tx?: Tx) {
  const { count } = await dbOrTx(tx).tenant.updateMany({ where: { id: tenantId }, data });
  return count > 0;
}

// ---- Stripe Connect state (Phase 5) ----------------------------------------------------------

/** Webhooks identify the shop only by its connected-account id. */
export function findByStripeAccountId(stripeAccountId: string, tx?: Tx) {
  return dbOrTx(tx).tenant.findUnique({ where: { stripeAccountId } });
}

/** Remember the connected account, but never overwrite one that is already set. */
export async function setStripeAccountId(tenantId: string, stripeAccountId: string, tx?: Tx) {
  const { count } = await dbOrTx(tx).tenant.updateMany({ where: { id: tenantId, stripeAccountId: null }, data: { stripeAccountId } });
  return count > 0;
}

export type StripeAccountState = {
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
  detailsSubmitted: boolean;
  requirementsDue: string[];
};

export function updateStripeState(stripeAccountId: string, state: StripeAccountState, tx?: Tx) {
  return dbOrTx(tx).tenant.updateMany({
    where: { stripeAccountId },
    data: {
      chargesEnabled: state.chargesEnabled,
      payoutsEnabled: state.payoutsEnabled,
      detailsSubmitted: state.detailsSubmitted,
      stripeRequirementsDue: state.requirementsDue,
    },
  });
}
