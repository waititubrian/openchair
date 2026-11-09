import "server-only";
import Stripe from "stripe";
import { env, requireEnv } from "@/lib/env";

// The single place the Stripe SDK is created. Openchair is TEST MODE ONLY, so a live key is
// refused here, before any request could be made with it.
let client: Stripe | undefined;

export function isStripeConfigured(): boolean {
  return Boolean(env.STRIPE_SECRET_KEY);
}

export function getStripe(): Stripe {
  if (client) return client;
  const key = requireEnv("STRIPE_SECRET_KEY");
  if (!/^(sk|rk)_test_/.test(key)) {
    throw new Error("Openchair is test-mode only: STRIPE_SECRET_KEY must be a test key (sk_test_...).");
  }
  client = new Stripe(key, { appInfo: { name: "Openchair" }, maxNetworkRetries: 2 });
  return client;
}

// Webhook signature checks need only the endpoint's signing secret, never the API key, so they
// use a separate client that cannot make API calls. A server with a webhook secret but no API key
// still answers forged requests with 400.
const signatureVerifier = new Stripe("sk_test_signature_verification_only");

export function constructWebhookEvent(rawBody: string, signature: string, secret: string): Stripe.Event {
  return signatureVerifier.webhooks.constructEvent(rawBody, signature, secret);
}
