/**
 * Best-effort client IP for throttling. On Vercel the platform sets x-vercel-forwarded-for
 * (and overwrites x-forwarded-for), so we trust it ONLY there; elsewhere a client could send
 * that header itself, so we use the first x-forwarded-for entry. Same reasoning as src/lib/auth.ts.
 */
export function clientIpFrom(headers: Headers): string {
  const raw = process.env.VERCEL ? headers.get("x-vercel-forwarded-for") : headers.get("x-forwarded-for");
  return raw?.split(",")[0]?.trim() || "unknown";
}
