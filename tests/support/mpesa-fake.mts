// A stand-in for Safaricom (no network) and helpers that build Daraja-shaped callbacks.
// Tests install it with:  vi.mock("@/lib/mpesa", () => mpesaModuleMock(holder))

export const CALLBACK_SECRET = "test-callback-secret-0123456789";

export type FakePush = { amountCents: number; phone: string; accountReference: string; description: string; checkoutRequestId: string; merchantRequestId: string };

type Query = { status: "pending" } | { status: "success" | "failed"; resultCode: number; resultDesc: string };

export function createMpesaFake() {
  const pushes: FakePush[] = [];
  const results = new Map<string, Query>();
  const state = { failPush: false, failQuery: false, queries: 0, n: 0 };
  const next = () => ++state.n;

  const gateway = {
    async stkPush(input: Omit<FakePush, "checkoutRequestId" | "merchantRequestId">) {
      if (state.failPush) throw new (await import("@/lib/errors")).MpesaError();
      const n = next();
      const push = { ...input, checkoutRequestId: `ws_CO_fake_${n}_${Math.random().toString(36).slice(2, 8)}`, merchantRequestId: `m-fake-${n}` };
      pushes.push(push);
      return { merchantRequestId: push.merchantRequestId, checkoutRequestId: push.checkoutRequestId, customerMessage: "Success. Request accepted for processing" };
    },
    async stkQuery(checkoutRequestId: string) {
      state.queries++;
      if (state.failQuery) throw new (await import("@/lib/errors")).MpesaError();
      return results.get(checkoutRequestId) ?? ({ status: "pending" } as Query);
    },
  };

  return {
    gateway,
    pushes,
    state,
    last: () => pushes.at(-1)!,
    /** What Safaricom's status query will answer for a prompt. */
    answer: (checkoutRequestId: string, q: Query) => results.set(checkoutRequestId, q),
    approve: (checkoutRequestId: string) => results.set(checkoutRequestId, { status: "success", resultCode: 0, resultDesc: "The service request is processed successfully." }),
    decline: (checkoutRequestId: string, resultCode = 1032, resultDesc = "Request cancelled by user") => results.set(checkoutRequestId, { status: "failed", resultCode, resultDesc }),
  };
}

/** The module replacement for "@/lib/mpesa" (pass the holder the test keeps its current fake in). */
export function mpesaModuleMock(holder: { current: ReturnType<typeof createMpesaFake> | null }) {
  return {
    getMpesa: async () => holder.current!.gateway,
    isMpesaConfigured: () => true,
    mpesaCallbackUrl: () => `http://localhost:3000/api/webhooks/mpesa/${CALLBACK_SECRET}`,
    createDarajaClient: () => holder.current!.gateway,
  };
}

/** A Daraja STK callback body. */
export function callbackBody(o: { checkoutRequestId: string; merchantRequestId?: string; resultCode?: number; resultDesc?: string; amountCents?: number; receipt?: string; phone?: string }) {
  const code = o.resultCode ?? 0;
  return {
    Body: {
      stkCallback: {
        MerchantRequestID: o.merchantRequestId ?? "m-cb",
        CheckoutRequestID: o.checkoutRequestId,
        ResultCode: code,
        ResultDesc: o.resultDesc ?? (code === 0 ? "The service request is processed successfully." : "Request cancelled by user"),
        ...(code === 0 && {
          CallbackMetadata: {
            Item: [
              { Name: "Amount", Value: (o.amountCents ?? 0) / 100 },
              { Name: "MpesaReceiptNumber", Value: o.receipt ?? `RCP${Math.random().toString(36).slice(2, 9).toUpperCase()}` },
              { Name: "TransactionDate", Value: 20310701150000 },
              { Name: "PhoneNumber", Value: Number(o.phone ?? "254712345678") },
            ],
          },
        }),
      },
    },
  };
}

export function callbackRequest(body: unknown, secret = CALLBACK_SECRET) {
  return new Request(`http://localhost:3000/api/webhooks/mpesa/${secret}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}
