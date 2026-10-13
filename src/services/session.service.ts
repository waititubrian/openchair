import "server-only";
import { cache } from "react";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { UnauthorizedError, ForbiddenError } from "@/lib/errors";
import { assertCan, can, type Permission } from "@/lib/permissions";
import type { SessionUser, TenantContext } from "@/lib/tenant-context";
import * as membershipRepo from "@/repositories/membership.repo";
import * as userRepo from "@/repositories/user.repo";

// The Data Access Layer from the Next.js auth guide: every protected page, action and
// route calls one of these FIRST. proxy.ts only does optimistic redirects; this is the
// real check. It is also where tenantId comes from: nothing downstream ever takes a
// tenantId from the URL or request body, only from the verified membership.
//
// React `cache` dedupes the lookups within one request (layout + page + action share them).

export type { SessionUser, TenantContext };

export const getSessionUser = cache(async (): Promise<SessionUser | null> => {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return null;
  const { id, name, email } = session.user;
  return { id, name, email };
});

export async function requireUser(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  return user;
}

const getMembership = cache((userId: string) => membershipRepo.findPrimaryForUser(userId));

/** Signed-in user's shop, or null when they haven't finished onboarding. */
export async function getTenantContext(): Promise<TenantContext | null> {
  const user = await getSessionUser();
  if (!user) return null;
  const membership = await getMembership(user.id);
  if (!membership) return null;
  return { user, tenant: membership.tenant, tenantId: membership.tenantId, role: membership.role };
}

/**
 * Entry point for every dashboard page / action. Redirects when signed out or not
 * onboarded, and sends the user to the "no access" page when the role lacks `permission`
 * (a redirect, not a throw: production hides thrown messages from Server Components).
 */
export async function requireTenantContext(permission?: Permission): Promise<TenantContext> {
  const user = await requireUser();
  const membership = await getMembership(user.id);
  if (!membership) redirect("/onboarding");
  const ctx: TenantContext = {
    user,
    tenant: membership.tenant,
    tenantId: membership.tenantId,
    role: membership.role,
  };
  if (permission && !can(ctx.role, permission)) redirect("/dashboard/forbidden");
  return ctx;
}

/**
 * Same checks as requireTenantContext, for route handlers: instead of redirecting it throws
 * UnauthorizedError (401) / ForbiddenError (403), which lib/http.ts turns into JSON.
 */
export async function requireApiTenantContext(permission?: Permission): Promise<TenantContext> {
  const user = await getSessionUser();
  if (!user) throw new UnauthorizedError();
  const membership = await getMembership(user.id);
  if (!membership) throw new ForbiddenError("Finish setting up your shop first");
  const ctx: TenantContext = {
    user,
    tenant: membership.tenant,
    tenantId: membership.tenantId,
    role: membership.role,
  };
  if (permission) assertCan(ctx, permission);
  return ctx;
}

/**
 * Platform owner only. Separate from tenant roles: a shop OWNER is not a platform admin.
 * Everyone else gets a 404 so the page's existence isn't revealed.
 */
export async function requirePlatformAdmin(): Promise<SessionUser> {
  const user = await requireUser();
  const record = await userRepo.findById(user.id);
  if (record?.platformRole !== "PLATFORM_ADMIN") notFound();
  return user;
}
