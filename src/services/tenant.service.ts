import "server-only";
import { assertCan } from "@/lib/permissions";
import type { TenantContext } from "@/lib/tenant-context";
import { BOOKING } from "@/lib/constants/business";
import { ConflictError, NotFoundError } from "@/lib/errors";
import * as availabilityRepo from "@/repositories/availability.repo";
import * as membershipRepo from "@/repositories/membership.repo";
import { isUniqueViolation } from "@/repositories/prisma-errors";
import * as serviceRepo from "@/repositories/service.repo";
import * as staffRepo from "@/repositories/staff.repo";
import * as tenantRepo from "@/repositories/tenant.repo";
import { runInTransaction } from "@/repositories/transaction";
import * as userRepo from "@/repositories/user.repo";
import type { UpdateSettingsInput } from "@/validators/settings";
import { slugSchema, type OnboardingInput } from "@/validators/tenant";

export async function isSlugAvailable(rawSlug: string): Promise<{ available: boolean; reason?: string }> {
  const parsed = slugSchema.safeParse(rawSlug);
  if (!parsed.success) return { available: false, reason: parsed.error.issues[0]?.message };
  return (await tenantRepo.slugExists(parsed.data))
    ? { available: false, reason: "That web address is taken" }
    : { available: true };
}

/**
 * Onboarding: create the shop and everything needed to take a first booking, atomically.
 * Either the whole thing exists or none of it does (no half-created shops).
 * The signed-up user becomes OWNER and also the shop's first bookable staff member.
 */
export async function onboard(userId: string, input: OnboardingInput) {
  const user = await userRepo.findById(userId);
  if (!user) throw new NotFoundError("User");

  try {
    return await runInTransaction(async (tx) => {
      if (await membershipRepo.userHasMembership(userId, tx)) {
        throw new ConflictError("You already have a shop", "ALREADY_ONBOARDED");
      }
      const tenant = await tenantRepo.create(
        {
          slug: input.slug,
          name: input.shopName,
          timezone: input.timezone,
          depositHoldMinutes: BOOKING.defaultHoldMinutes,
        },
        tx,
      );
      await membershipRepo.create(tenant.id, userId, "OWNER", tx);
      const service = await serviceRepo.create(
        tenant.id,
        {
          name: input.service.name,
          durationMin: input.service.durationMin,
          priceCents: input.service.price,
          depositCents: input.service.deposit,
        },
        tx,
      );
      const staff = await staffRepo.create(tenant.id, { name: user.name, userId }, tx);
      await staffRepo.assignServices(tenant.id, staff.id, [service.id], tx);
      await availabilityRepo.replaceWeekly(
        tenant.id,
        staff.id,
        input.hours.map((h) => ({ dayOfWeek: h.dayOfWeek, startMinute: h.start, endMinute: h.end })),
        tx,
      );
      return tenant;
    });
  } catch (e) {
    // Two people can pass the availability check and submit at once: the unique index decides.
    if (isUniqueViolation(e)) throw new ConflictError("That web address was just taken", "SLUG_TAKEN");
    throw e;
  }
}

/** Shop settings (name, timezone). OWNER only (settings:manage). */
export async function getSettings(ctx: Pick<TenantContext, "tenant" | "role">) {
  assertCan(ctx, "settings:manage");
  const { name, slug, timezone, currency } = ctx.tenant;
  return { name, slug, timezone, currency };
}

export async function updateSettings(
  ctx: Pick<TenantContext, "tenantId" | "tenant" | "role">,
  patch: UpdateSettingsInput,
) {
  assertCan(ctx, "settings:manage");
  await tenantRepo.update(ctx.tenantId, patch);
  const fresh = await tenantRepo.findById(ctx.tenantId);
  if (!fresh) throw new NotFoundError("Shop");
  return { name: fresh.name, slug: fresh.slug, timezone: fresh.timezone, currency: fresh.currency };
}
