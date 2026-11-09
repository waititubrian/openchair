import { timingSafeEqual } from "node:crypto";
import { connection } from "next/server";
import { env } from "@/lib/env";
import { handle } from "@/lib/http";
import { sweepExpiredHolds } from "@/services/booking-expiry.service";

// Called by Vercel Cron (see vercel.json). Vercel sends "Authorization: Bearer $CRON_SECRET".
// If CRON_SECRET isn't set the endpoint refuses everything rather than running unauthenticated.
function authorised(req: Request): boolean {
  const secret = env.CRON_SECRET;
  const header = req.headers.get("authorization") ?? "";
  if (!secret) return false;
  const expected = Buffer.from(`Bearer ${secret}`);
  const actual = Buffer.from(header);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export async function GET(req: Request) {
  await connection(); // always run per request, never prerender at build time
  return handle(async () => {
    if (!authorised(req)) return Response.json({ error: "Unauthorized" }, { status: 401 });
    return Response.json(await sweepExpiredHolds());
  });
}
