import "server-only";

// Duck-typed so it works for both Prisma's own errors and driver-adapter errors.
export function isUniqueViolation(e: unknown): boolean {
  return typeof e === "object" && e !== null && (e as { code?: unknown }).code === "P2002";
}

/** A row is still referenced by another table (e.g. deleting a service that has bookings). */
export function isForeignKeyViolation(e: unknown): boolean {
  return typeof e === "object" && e !== null && (e as { code?: unknown }).code === "P2003";
}
