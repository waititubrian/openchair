import "server-only";
import { assertCan } from "@/lib/permissions";
import type { TenantContext } from "@/lib/tenant-context";
import { NotFoundError } from "@/lib/errors";
import * as staffRepo from "@/repositories/staff.repo";
import type { UpdateStaffInput } from "@/validators/staff";

type Ctx = Pick<TenantContext, "tenantId" | "role">;

export async function listStaff(ctx: Ctx) {
  assertCan(ctx, "staff:read");
  return staffRepo.list(ctx.tenantId);
}

export async function getStaffMember(ctx: Ctx, staffId: string) {
  assertCan(ctx, "staff:read");
  const staff = await staffRepo.findById(ctx.tenantId, staffId);
  if (!staff) throw new NotFoundError("Staff member");
  return staff;
}

/** OWNER only (staff:write). Editing a person's profile is not the same as their own availability. */
export async function updateStaffMember(ctx: Ctx, staffId: string, patch: UpdateStaffInput) {
  assertCan(ctx, "staff:write");
  if (!(await staffRepo.update(ctx.tenantId, staffId, patch))) throw new NotFoundError("Staff member");
  return getStaffMember(ctx, staffId);
}
