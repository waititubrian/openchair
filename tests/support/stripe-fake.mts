import Stripe from "stripe";

// A stand-in for the Stripe API (no network), plus helpers that build and SIGN webhook requests
// with the real SDK's signing code, so signature verification in the app is exercised for real.

export const CONNECT_WEBHOOK_SECRET = "whsec_integration_connect";
const real = new Stripe("sk_test_signing_only");

export type Call = { method: string; params: any; options?: any };

export function createStripeFake() {
  const calls: Call[] = [];
  const sessions = new Map<string, any>();
  const idempotent = new Map<string, any>();
  const accounts = new Map<string, any>();
  const state = { failRefunds: false, n: 0 };
  const next = (prefix: string) => `${prefix}_${++state.n}_${Math.random().toString(36).slice(2, 7)}`;

  /** Stripe replays the original response when the same idempotency key is sent again. */
  const once = <T,>(options: any, make: () => T): T => {
    const key = options?.idempotencyKey as string | undefined;
    if (key && idempotent.has(key)) return idempotent.get(key);
    const value = make();
    if (key) idempotent.set(key, value);
    return value;
  };
  const record = (method: string, params: any, options?: any) => calls.push({ method, params, options });

  const fake = {
    webhooks: real.webhooks,
    accounts: {
      create: async (params: any, options?: any) => {
        record("accounts.create", params, options);
        return once(options, () => {
          const acct = { id: next("acct_test"), charges_enabled: false, payouts_enabled: false, details_submitted: false, requirements: { currently_due: ["individual.verification.document"] } };
          accounts.set(acct.id, acct);
          return acct;
        });
      },
      retrieve: async (id: string) => {
        record("accounts.retrieve", { id });
        return accounts.get(id) ?? { id, charges_enabled: false, payouts_enabled: false, details_submitted: false, requirements: { currently_due: [] } };
      },
      createLoginLink: async (id: string) => {
        record("accounts.createLoginLink", { id });
        return { url: `https://dashboard.stripe.test/express/${id}` };
      },
    },
    accountLinks: {
      create: async (params: any) => {
        record("accountLinks.create", params);
        return { url: `https://connect.stripe.test/setup/${params.account}` };
      },
    },
    checkout: {
      sessions: {
        create: async (params: any, options?: any) => {
          record("checkout.sessions.create", params, options);
          return once(options, () => {
            const id = next("cs_test");
            const session = {
              id,
              object: "checkout.session",
              url: `https://checkout.stripe.test/${id}`,
              status: "open",
              payment_status: "unpaid",
              amount_total: params.line_items[0].price_data.unit_amount,
              currency: params.line_items[0].price_data.currency,
              metadata: params.metadata,
              payment_intent: null,
              expires_at: params.expires_at,
            };
            sessions.set(id, session);
            return session;
          });
        },
        retrieve: async (id: string, _p: unknown, options?: any) => {
          record("checkout.sessions.retrieve", { id }, options);
          const s = sessions.get(id);
          if (!s) throw new Error(`No such checkout session: ${id}`);
          return s;
        },
        expire: async (id: string, _p: unknown, options?: any) => {
          record("checkout.sessions.expire", { id }, options);
          const s = sessions.get(id);
          if (!s || s.status !== "open") throw new Error("Session cannot be expired");
          s.status = "expired";
          return s;
        },
      },
    },
    refunds: {
      create: async (params: any, options?: any) => {
        record("refunds.create", params, options);
        if (state.failRefunds) throw new Error("Stripe is down");
        return once(options, () => ({ id: next("re"), status: "succeeded", payment_intent: params.payment_intent }));
      },
    },
  };

  return { fake, calls, sessions, accounts, state, callsTo: (m: string) => calls.filter((c) => c.method === m) };
}

// ---- events and signed requests -----------------------------------------------------------------

let evtN = 0;
export function stripeEvent(type: string, object: unknown, over: { id?: string; account?: string | null } = {}) {
  const account = over.account === undefined ? undefined : (over.account ?? undefined);
  return {
    id: over.id ?? `evt_test_${++evtN}_${Math.random().toString(36).slice(2, 8)}`,
    object: "event",
    type,
    created: Math.floor(Date.now() / 1000),
    livemode: false,
    api_version: "2026-10-28.endive",
    pending_webhooks: 1,
    request: { id: null, idempotency_key: null },
    ...(account ? { account } : {}),
    data: { object },
  };
}

export function paidSession(o: { id: string; bookingId: string; amount: number; paymentIntent?: string }) {
  return {
    id: o.id,
    object: "checkout.session",
    status: "complete",
    payment_status: "paid",
    amount_total: o.amount,
    currency: "usd",
    payment_intent: o.paymentIntent ?? `pi_test_${o.id}`,
    metadata: { bookingId: o.bookingId },
  };
}

export function signedRequest(evt: unknown, opts: { secret?: string; header?: string | null; tamper?: boolean } = {}) {
  const body = JSON.stringify(evt);
  const signature =
    opts.header === undefined ? real.webhooks.generateTestHeaderString({ payload: body, secret: opts.secret ?? CONNECT_WEBHOOK_SECRET }) : opts.header;
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (signature !== null) headers["stripe-signature"] = signature;
  return new Request("http://localhost:3000/api/webhooks/stripe-connect", {
    method: "POST",
    headers,
    body: opts.tamper ? body.replace(/"type":"[^"]+"/, '"type":"checkout.session.expired"') : body,
  });
}
