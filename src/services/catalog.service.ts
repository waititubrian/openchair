import "server-only";
import { assertCan } from "@/lib/permissions";
import type { TenantContext } from "@/lib/tenant-context";
import { NotFoundError } from "@/lib/errors";
import { ConflictError } from "@/lib/errors";
import * as serviceRepo from "@/repositories/service.repo";
import type { UpdateServiceInput } from "@/validators/catalog";

// "Catalog" = the bookable Services a shop offers.
type Ctx = Pick<TenantContext, "tenantId" | "role">;

export async function listServices(ctx: Ctx) {
  assertCan(ctx, "services:read");
  return serviceRepo.list(ctx.tenantId);
}

export async function getService(ctx: Ctx, serviceId: string) {
  assertCan(ctx, "services:read");
  const service = await serviceRepo.findById(ctx.tenantId, serviceId);
  if (!service) throw new NotFoundError("Service");
  return service;
}

/** OWNER only (services:write). Changes apply to future bookings; past ones keep snapshotted prices. */
export async function updateService(ctx: Ctx, serviceId: string, patch: UpdateServiceInput) {
  assertCan(ctx, "services:write");
  const existing = await serviceRepo.findById(ctx.tenantId, serviceId);
  if (!existing) throw new NotFoundError("Service");

  const price = patch.priceCents ?? existing.priceCents;
  const deposit = patch.depositCents ?? existing.depositCents;
  if (deposit > price) throw new ConflictError("Deposit can't exceed the price", "DEPOSIT_EXCEEDS_PRICE");

  await serviceRepo.update(ctx.tenantId, serviceId, patch);
  return getService(ctx, serviceId);
}
