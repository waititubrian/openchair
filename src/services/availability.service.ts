import "server-only";
import { assertCan } from "@/lib/permissions";
import type { TenantContext } from "@/lib/tenant-context";
import { ForbiddenError, NotFoundError } from "@/lib/errors";
import * as availabilityRepo from "@/repositories/availability.repo";
import * as staffRepo from "@/repositories/staff.repo";
import * as timeOffRepo from "@/repositories/timeoff.repo";
import type { TimeOffInput, WeeklyRulesInput } from "@/validators/availability";

type Ctx = Pick<TenantContext, "tenantId" | "role"> & { user: { id: string } };

/**
 * THE rule for schedules: an OWNER manages every staff member's availability and time off
 * in their shop; a STAFF user manages only their own, identified by StaffMember.userId
 * matching the acting user's id. Checked here, in the service, so it holds for pages,
 * server actions and API routes alike. Hiding buttons in the UI is only cosmetic.
 *
 * Order matters: tenant-scoped lookup first (another shop's staff id is a 404, it never
 * reaches the ownership check), then the ownership check (a colleague's id is a 403).
 */
async function loadManageableStaff(ctx: Ctx, staffId: string) {
  assertCan(ctx, "availability:write");
  const staff = await staffRepo.findById(ctx.tenantId, staffId);
  if (!staff) throw new NotFoundError("Staff member");
  if (ctx.role !== "OWNER" && staff.userId !== ctx.user.id) {
    throw new ForbiddenError("You can only manage your own availability");
  }
  return staff;
}

/** Reading a colleague's schedule is allowed for anyone who can see staff (the booking calendar needs it). */
export async function getWeekly(ctx: Ctx, staffId: string) {
  assertCan(ctx, "staff:read");
  if (!(await staffRepo.findById(ctx.tenantId, staffId))) throw new NotFoundError("Staff member");
  return availabilityRepo.listWeekly(ctx.tenantId, staffId);
}

export async function replaceWeekly(ctx: Ctx, staffId: string, rules: WeeklyRulesInput) {
  await loadManageableStaff(ctx, staffId);
  await availabilityRepo.replaceWeekly(ctx.tenantId, staffId, rules);
  return availabilityRepo.listWeekly(ctx.tenantId, staffId);
}

export async function listTimeOff(ctx: Ctx, staffId: string) {
  assertCan(ctx, "staff:read");
  if (!(await staffRepo.findById(ctx.tenantId, staffId))) throw new NotFoundError("Staff member");
  return timeOffRepo.listForStaff(ctx.tenantId, staffId);
}

export async function addTimeOff(ctx: Ctx, staffId: string, input: TimeOffInput) {
  await loadManageableStaff(ctx, staffId);
  return timeOffRepo.create(ctx.tenantId, {
    staffId,
    startsAt: new Date(input.startsAt),
    endsAt: new Date(input.endsAt),
    reason: input.reason,
  });
}

export async function removeTimeOff(ctx: Ctx, timeOffId: string) {
  assertCan(ctx, "availability:write");
  const entry = await timeOffRepo.findById(ctx.tenantId, timeOffId);
  if (!entry) throw new NotFoundError("Time off");
  await loadManageableStaff(ctx, entry.staffId); // same ownership rule as creating it
  await timeOffRepo.remove(ctx.tenantId, timeOffId);
}
