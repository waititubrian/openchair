import { handle } from "@/lib/http";
import { handleConnectWebhook } from "@/services/stripe-webhook.service";

// Stripe -> us, for connected accounts. Configure in the Stripe Dashboard (Developers > Webhooks >
// "Connected accounts") or forward locally:  stripe listen --forward-connect-to localhost:3000/api/webhooks/stripe-connect
//
// The raw body is read as TEXT because the signature covers the exact bytes Stripe sent.
// Responses: 200 handled (including duplicates and ignored types), 400 bad signature, 500 failed
// (Stripe retries 5xx for up to three days, and our transaction guarantees a clean retry).
export async function POST(req: Request) {
  return handle(async () => {
    const rawBody = await req.text();
    const { outcome } = await handleConnectWebhook(rawBody, req.headers.get("stripe-signature"));
    return Response.json({ received: true, outcome });
  });
}
