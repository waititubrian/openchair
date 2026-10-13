import "server-only";
import { assertCan } from "@/lib/permissions";
import type { TenantContext } from "@/lib/tenant-context";
import { NotFoundError } from "@/lib/errors";
import * as customerRepo from "@/repositories/customer.repo";

type Ctx = Pick<TenantContext, "tenantId" | "role">;

export async function listCustomers(ctx: Ctx) {
  assertCan(ctx, "customers:read");
  return customerRepo.list(ctx.tenantId);
}

export async function getCustomer(ctx: Ctx, customerId: string) {
  assertCan(ctx, "customers:read");
  const customer = await customerRepo.findById(ctx.tenantId, customerId);
  if (!customer) throw new NotFoundError("Customer");
  return customer;
}
