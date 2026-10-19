import "server-only";
import { ConflictError, NotFoundError } from "@/lib/errors";
import { assertCan } from "@/lib/permissions";
import type { TenantContext } from "@/lib/tenant-context";
import * as bookingRepo from "@/repositories/booking.repo";
import { isForeignKeyViolation } from "@/repositories/prisma-errors";
import * as serviceRepo from "@/repositories/service.repo";
import * as staffRepo from "@/repositories/staff.repo";
import { runInTransaction, type Tx } from "@/repositories/transaction";
import type { CreateServiceInput, UpdateServiceInput } from "@/validators/catalog";

// "Catalog" = the bookable Services a shop offers. Reads: anyone who can see services.
// Writes: OWNER only (services:write). Changes apply to future bookings; past bookings keep
// their snapshotted prices.
type Ctx = Pick<TenantContext, "tenantId" | "role">;

const dedupe = (ids: string[]) => [...new Set(ids)];

/** Every staff id must belong to THIS shop (a foreign id is reported as not found). */
async function assertStaffInTenant(tenantId: string, staffIds: string[], tx?: Tx) {
  if (staffIds.length && (await staffRepo.countByIds(tenantId, staffIds, tx)) !== staffIds.length) {
    throw new NotFoundError("Staff member");
  }
}

function assertMoney(priceCents: number, depositCents: number) {
  if (depositCents > priceCents) throw new ConflictError("Deposit can't exceed the price", "DEPOSIT_EXCEEDS_PRICE");
}

export async function listServices(ctx: Ctx) {
  assertCan(ctx, "services:read");
  return serviceRepo.list(ctx.tenantId);
}

/** The service plus which staff offer it. */
export async function getService(ctx: Ctx, serviceId: string) {
  assertCan(ctx, "services:read");
  const service = await serviceRepo.findById(ctx.tenantId, serviceId);
  if (!service) throw new NotFoundError("Service");
  return { ...service, staffIds: await serviceRepo.listStaffIds(ctx.tenantId, serviceId) };
}

export async function createService(ctx: Ctx, input: CreateServiceInput) {
  assertCan(ctx, "services:write");
  assertMoney(input.priceCents, input.depositCents);
  const staffIds = dedupe(input.staffIds);
  const id = await runInTransaction(async (tx) => {
    await assertStaffInTenant(ctx.tenantId, staffIds, tx);
    const { staffIds: _omit, ...fields } = input;
    void _omit;
    const created = await serviceRepo.create(ctx.tenantId, fields, tx);
    await serviceRepo.setStaff(ctx.tenantId, created.id, staffIds, tx);
    return created.id;
  });
  return getService(ctx, id);
}

export async function updateService(ctx: Ctx, serviceId: string, patch: UpdateServiceInput) {
  assertCan(ctx, "services:write");
  const existing = await serviceRepo.findById(ctx.tenantId, serviceId);
  if (!existing) throw new NotFoundError("Service");
  assertMoney(patch.priceCents ?? existing.priceCents, patch.depositCents ?? existing.depositCents);

  const { staffIds, ...fields } = patch;
  const ids = staffIds && dedupe(staffIds);
  await runInTransaction(async (tx) => {
    if (ids) await assertStaffInTenant(ctx.tenantId, ids, tx);
    if (Object.keys(fields).length) await serviceRepo.update(ctx.tenantId, serviceId, fields, tx);
    if (ids) await serviceRepo.setStaff(ctx.tenantId, serviceId, ids, tx);
  });
  return getService(ctx, serviceId);
}

/**
 * Hard delete is only allowed for a service that was never booked; otherwise deactivate it
 * (active=false hides it from booking but keeps history intact).
 */
export async function deleteService(ctx: Ctx, serviceId: string) {
  assertCan(ctx, "services:write");
  if (!(await serviceRepo.findById(ctx.tenantId, serviceId))) throw new NotFoundError("Service");
  if ((await bookingRepo.countForService(ctx.tenantId, serviceId)) > 0) {
    throw new ConflictError("This service has bookings. Deactivate it instead of deleting it.", "HAS_BOOKINGS");
  }
  try {
    await serviceRepo.remove(ctx.tenantId, serviceId);
  } catch (e) {
    // A booking slipped in between the check and the delete: the foreign key is the final guard.
    if (isForeignKeyViolation(e)) {
      throw new ConflictError("This service has bookings. Deactivate it instead of deleting it.", "HAS_BOOKINGS");
    }
    throw e;
  }
}

