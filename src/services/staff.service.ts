import "server-only";
import { ConflictError, NotFoundError } from "@/lib/errors";
import { assertCan } from "@/lib/permissions";
import type { TenantContext } from "@/lib/tenant-context";
import * as bookingRepo from "@/repositories/booking.repo";
import { isForeignKeyViolation } from "@/repositories/prisma-errors";
import * as serviceRepo from "@/repositories/service.repo";
import * as staffRepo from "@/repositories/staff.repo";
import { runInTransaction, type Tx } from "@/repositories/transaction";
import type { CreateStaffInput, UpdateStaffInput } from "@/validators/staff";
import * as planService from "./plan.service";

// Staff members are the bookable people. Reads: anyone who can see staff. Writes (profile,
// services, add/remove): OWNER only (staff:write). A person's own SCHEDULE is separate and
// lives in availability.service (STAFF may edit their own).
type Ctx = Pick<TenantContext, "tenantId" | "role" | "tenant">;

const dedupe = (ids: string[]) => [...new Set(ids)];

async function assertServicesInTenant(tenantId: string, serviceIds: string[], tx?: Tx) {
  if (serviceIds.length && (await serviceRepo.countByIds(tenantId, serviceIds, tx)) !== serviceIds.length) {
    throw new NotFoundError("Service");
  }
}

export async function listStaff(ctx: Ctx) {
  assertCan(ctx, "staff:read");
  return staffRepo.list(ctx.tenantId);
}

/** The staff member plus the services they perform. */
export async function getStaffMember(ctx: Ctx, staffId: string) {
  assertCan(ctx, "staff:read");
  const staff = await staffRepo.findById(ctx.tenantId, staffId);
  if (!staff) throw new NotFoundError("Staff member");
  return { ...staff, serviceIds: await staffRepo.listServiceIds(ctx.tenantId, staffId) };
}

/** The StaffMember linked to the signed-in user, or null (e.g. an owner who isn't bookable). */
export async function getOwnStaffMember(ctx: Ctx & { user: { id: string } }) {
  assertCan(ctx, "staff:read");
  return staffRepo.findByUserId(ctx.tenantId, ctx.user.id);
}

export async function createStaffMember(ctx: Ctx, input: CreateStaffInput) {
  assertCan(ctx, "staff:write");
  const serviceIds = dedupe(input.serviceIds);
  const id = await runInTransaction(async (tx) => {
    await planService.assertCanAddActiveStaff(ctx, tx); // Free plan: 1 active staff member
    await assertServicesInTenant(ctx.tenantId, serviceIds, tx);
    const created = await staffRepo.create(ctx.tenantId, { name: input.name }, tx);
    await staffRepo.setServices(ctx.tenantId, created.id, serviceIds, tx);
    return created.id;
  });
  return getStaffMember(ctx, id);
}

export async function updateStaffMember(ctx: Ctx, staffId: string, patch: UpdateStaffInput) {
  assertCan(ctx, "staff:write");
  const existing = await staffRepo.findById(ctx.tenantId, staffId);
  if (!existing) throw new NotFoundError("Staff member");

  const { serviceIds, ...fields } = patch;
  const ids = serviceIds && dedupe(serviceIds);
  await runInTransaction(async (tx) => {
    // Reactivating someone counts against the plan just like adding a new person.
    if (fields.active === true && !existing.active) await planService.assertCanAddActiveStaff(ctx, tx);
    if (ids) await assertServicesInTenant(ctx.tenantId, ids, tx);
    if (Object.keys(fields).length) await staffRepo.update(ctx.tenantId, staffId, fields, tx);
    if (ids) await staffRepo.setServices(ctx.tenantId, staffId, ids, tx);
  });
  return getStaffMember(ctx, staffId);
}

/** Hard delete only if the person never had a booking; otherwise deactivate them. */
export async function deleteStaffMember(ctx: Ctx, staffId: string) {
  assertCan(ctx, "staff:write");
  if (!(await staffRepo.findById(ctx.tenantId, staffId))) throw new NotFoundError("Staff member");
  const blocked = () =>
    new ConflictError("This person has bookings. Deactivate them instead of deleting them.", "HAS_BOOKINGS");
  if ((await bookingRepo.countForStaff(ctx.tenantId, staffId)) > 0) throw blocked();
  try {
    await staffRepo.remove(ctx.tenantId, staffId);
  } catch (e) {
    if (isForeignKeyViolation(e)) throw blocked();
    throw e;
  }
}
