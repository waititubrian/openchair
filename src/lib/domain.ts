// The ONE place generated Prisma enums/types are re-exported for the rest of the app.
// Services, validators and components import domain vocabulary (BookingStatus, Plan, ...)
// from here, so they never touch the Prisma client package itself. These are plain
// string-union enums with no database access, so this file is safe in client code too.
export {
  BookingStatus,
  MembershipRole,
  PaymentStatus,
  Plan,
  PlatformRole,
} from "@/generated/prisma/enums";
export type {
  Booking,
  Customer,
  Payment,
  Service,
  StaffMember,
  Subscription,
  Tenant,
} from "@/generated/prisma/client";
