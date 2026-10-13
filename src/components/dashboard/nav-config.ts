import type { Permission } from "@/lib/permissions";

// Which sidebar links exist and what permission each requires. The shell filters this
// with can(role, permission) so STAFF never see Billing/Payouts/Settings. Hiding is
// cosmetic: each page enforces the same permission on the server.
export const DASHBOARD_NAV: { href: string; label: string; permission: Permission }[] = [
  { href: "/dashboard", label: "Overview", permission: "bookings:read" },
  { href: "/dashboard/bookings", label: "Bookings", permission: "bookings:read" },
  { href: "/dashboard/services", label: "Services", permission: "services:read" },
  { href: "/dashboard/staff", label: "Staff", permission: "staff:read" },
  { href: "/dashboard/availability", label: "Availability", permission: "availability:write" },
  { href: "/dashboard/customers", label: "Customers", permission: "customers:read" },
  { href: "/dashboard/billing", label: "Billing", permission: "billing:manage" },
  { href: "/dashboard/payouts", label: "Payouts", permission: "payouts:manage" },
  { href: "/dashboard/settings", label: "Settings", permission: "settings:manage" },
];
