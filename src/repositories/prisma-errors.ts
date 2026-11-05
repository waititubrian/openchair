import "server-only";

// Duck-typed so it works for both Prisma's own errors and driver-adapter errors.
export function isUniqueViolation(e: unknown): boolean {
  return typeof e === "object" && e !== null && (e as { code?: unknown }).code === "P2002";
}

/** A row is still referenced by another table (e.g. deleting a service that has bookings). */
export function isForeignKeyViolation(e: unknown): boolean {
  return typeof e === "object" && e !== null && (e as { code?: unknown }).code === "P2003";
}

/**
 * The Postgres exclusion constraint "booking_no_overlap" fired: two live bookings for one staff
 * member would overlap. With Prisma 7 + the pg adapter this surfaces as a
 * PrismaClientKnownRequestError (code P2039) whose meta carries the original SQLSTATE 23P01,
 * so we look at the Postgres code and the constraint name, not Prisma's own code.
 */
export function isOverlapViolation(e: unknown): boolean {
  if (typeof e !== "object" || e === null) return false;
  const meta = (e as { meta?: { driverAdapterError?: { cause?: { originalCode?: unknown; originalMessage?: unknown } } } }).meta;
  const cause = meta?.driverAdapterError?.cause;
  if (cause?.originalCode === "23P01") return true;
  return typeof cause?.originalMessage === "string" && cause.originalMessage.includes("booking_no_overlap");
}
