import type { MembershipRole } from "@/lib/domain";
import { ForbiddenError } from "@/lib/errors";

// Single source of truth for "who can do what" inside a shop. Used by services to
// enforce (server-side) and by the UI to hide links. Hiding is cosmetic; enforcement
// always happens in the service via requirePermission().
//
// OWNER can do everything. STAFF sees and edits all bookings and can manage
// availability/time off, but has NO access to billing, payouts or settings.
// (A per-staff "only my bookings" visibility option is a possible future setting.)
export const PERMISSIONS = [
  "bookings:read",
  "bookings:write",
  "customers:read",
  "services:read",
  "services:write",
  "staff:read",
  "staff:write",
  "availability:write",
  "analytics:read",
  "billing:manage",
  "payouts:manage",
  "settings:manage",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

const STAFF_PERMISSIONS: ReadonlySet<Permission> = new Set([
  "bookings:read",
  "bookings:write",
  "customers:read",
  "services:read",
  "staff:read",
  "availability:write",
  "analytics:read",
]);

export function can(role: MembershipRole, permission: Permission): boolean {
  if (role === "OWNER") return true;
  return STAFF_PERMISSIONS.has(permission);
}

/** Throws ForbiddenError (403) when the role lacks the permission. Used by every service. */
export function assertCan(ctx: { role: MembershipRole }, permission: Permission): void {
  if (!can(ctx.role, permission)) throw new ForbiddenError("Your role doesn't have access to this");
}

/**
 * Who may edit a staff member's schedule (weekly hours, time off): an OWNER always; a STAFF user
 * only their own StaffMember (the one whose userId is theirs). One rule, used by the service
 * (enforcement) and the pages (deciding whether to render the editor).
 */
export function canManageSchedule(
  actor: { role: MembershipRole; userId: string },
  staffMember: { userId: string | null },
): boolean {
  return actor.role === "OWNER" || (can(actor.role, "availability:write") && staffMember.userId === actor.userId);
}
