import { timingSafeEqual } from "node:crypto";
import { env } from "@/lib/env";
import { handle, readJson } from "@/lib/http";
import { handleStkCallback } from "@/services/mpesa-settlement.service";

// Safaricom -> us: the STK Push result. M-Pesa callbacks are NOT signed, so two things protect this URL:
//   1. the path contains MPESA_CALLBACK_SECRET (unguessable; compared in constant time), and
//   2. nothing in the body is believed: the service asks Safaricom's status-query API about the
//      CheckoutRequestID (which must be a prompt WE sent) and acts on that answer.
//
// Always 200 for a callback that looks genuine (even one we ignore or can't verify yet), so Safaricom
// doesn't retry in a loop; anything unresolved is settled later by status polling or the daily sweep.
const ACK = { ResultCode: 0, ResultDesc: "Accepted" };

function secretMatches(given: string): boolean {
  const expected = env.MPESA_CALLBACK_SECRET;
  if (!expected) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(req: Request, route: RouteContext<"/api/webhooks/mpesa/[secret]">) {
  return handle(async () => {
    const { secret } = await route.params;
    if (!secretMatches(secret)) return new Response("Not found", { status: 404 }); // don't confirm the URL exists
    const outcome = await handleStkCallback(await readJson(req));
    return Response.json({ ...ACK, outcome });
  });
}
