import "server-only";

// Duck-typed so it works for both Prisma's own errors and driver-adapter errors.
export function isUniqueViolation(e: unknown): boolean {
  return typeof e === "object" && e !== null && (e as { code?: unknown }).code === "P2002";
}
