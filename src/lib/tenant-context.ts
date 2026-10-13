import type { MembershipRole, Tenant } from "@/lib/domain";

/** The verified identity every service call runs as. Built only by session.service. */
export type SessionUser = { id: string; name: string; email: string };

export type TenantContext = {
  user: SessionUser;
  tenant: Tenant;
  tenantId: string;
  role: MembershipRole;
};
