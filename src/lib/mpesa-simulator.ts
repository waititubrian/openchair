import "server-only";
import { MpesaError } from "@/lib/errors";
import type { MpesaGateway, StkPushInput, StkQueryResult } from "@/lib/mpesa";

// A stand-in for Safaricom, for LOCAL DEVELOPMENT and demos: no Safaricom account and no public
// tunnel needed. It behaves like Daraja: the push returns ids immediately, the "customer" answers a
// couple of seconds later, and the result arrives as a Daraja-shaped callback POSTed to our own
// callback URL (so the whole real callback path is exercised).
//
// It can never run in production: src/lib/mpesa.ts refuses MPESA_MODE=simulator there.
//
// Pick the outcome with the phone number:
//   254700000001  customer cancels the prompt        (ResultCode 1032)
//   254700000002  insufficient funds                 (ResultCode 1)
//   254700000003  phone never answers, no callback   (ResultCode 1037, only visible via query)
//   254700000004  wrong PIN                          (ResultCode 2001)
//   anything else succeeds

type Outcome = { code: number; desc: string; callback: boolean };

const OUTCOMES: Record<string, Outcome> = {
  "254700000001": { code: 1032, desc: "Request cancelled by user", callback: true },
  "254700000002": { code: 1, desc: "The balance is insufficient for the transaction", callback: true },
  "254700000003": { code: 1037, desc: "DS timeout user cannot be reached", callback: false },
  "254700000004": { code: 2001, desc: "The initiator information is invalid", callback: true },
};
const SUCCESS: Outcome = { code: 0, desc: "The service request is processed successfully.", callback: true };

type Request = { amountCents: number; phone: string; outcome: Outcome; receipt: string; readyAt: number };
// Shared across hot reloads so a request survives a module reload during dev.
const store = ((globalThis as { __mpesaSim?: Map<string, Request> }).__mpesaSim ??= new Map());

const rand = (n: number) => Math.random().toString(36).slice(2, 2 + n).toUpperCase();

export function createSimulatorGateway(opts: { callbackUrl: () => string; delayMs?: number }): MpesaGateway {
  const delay = opts.delayMs ?? Number(process.env.MPESA_SIMULATOR_DELAY_MS ?? 2000);

  return {
    async stkPush(input: StkPushInput) {
      if (input.amountCents % 100 !== 0 || input.amountCents < 100) throw new MpesaError("Amount must be whole shillings.");
      const checkoutRequestId = `ws_CO_SIM_${Date.now()}_${rand(6)}`;
      const merchantRequestId = `sim-${rand(8)}`;
      const outcome = OUTCOMES[input.phone] ?? SUCCESS;
      const request: Request = { amountCents: input.amountCents, phone: input.phone, outcome, receipt: `SIM${rand(7)}`, readyAt: Date.now() + delay };
      store.set(checkoutRequestId, request);

      if (outcome.callback) {
        const timer = setTimeout(() => void deliver(opts.callbackUrl(), merchantRequestId, checkoutRequestId, request), delay);
        timer.unref?.();
      }
      return { merchantRequestId, checkoutRequestId, customerMessage: "Simulated: check your phone and enter your M-Pesa PIN." };
    },

    async stkQuery(checkoutRequestId): Promise<StkQueryResult> {
      const request = store.get(checkoutRequestId);
      if (!request) throw new MpesaError("Unknown payment request.");
      if (Date.now() < request.readyAt) return { status: "pending" };
      return { status: request.outcome.code === 0 ? "success" : "failed", resultCode: request.outcome.code, resultDesc: request.outcome.desc };
    },
  };
}

/** POST a Daraja-shaped callback to our own endpoint, exactly as Safaricom would. */
async function deliver(url: string, merchantRequestId: string, checkoutRequestId: string, r: Request) {
  const ok = r.outcome.code === 0;
  const body = {
    Body: {
      stkCallback: {
        MerchantRequestID: merchantRequestId,
        CheckoutRequestID: checkoutRequestId,
        ResultCode: r.outcome.code,
        ResultDesc: r.outcome.desc,
        ...(ok && {
          CallbackMetadata: {
            Item: [
              { Name: "Amount", Value: r.amountCents / 100 },
              { Name: "MpesaReceiptNumber", Value: r.receipt },
              { Name: "TransactionDate", Value: Number(new Date().toISOString().replace(/\D/g, "").slice(0, 14)) },
              { Name: "PhoneNumber", Value: Number(r.phone) },
            ],
          },
        }),
      },
    },
  };
  try {
    await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  } catch (e) {
    console.error("simulated M-Pesa callback could not be delivered", e);
  }
}
