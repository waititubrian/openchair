import "server-only";
import { formatInTimeZone } from "date-fns-tz";
import { z } from "zod";
import { env } from "@/lib/env";
import { MpesaError, MpesaNotConfiguredError } from "@/lib/errors";

// The ONE place that talks to Safaricom's Daraja API (M-Pesa Express / STK Push). SANDBOX ONLY:
// Openchair is test-mode, so a production configuration is refused before any request is made.
//
// How an STK Push works: we ask Safaricom to pop a PIN prompt on the customer's phone. The answer
// arrives LATER as a callback to our public URL (and can be fetched with the query call).

export type StkPushInput = {
  /** Cents of KES. Must be a whole number of shillings: M-Pesa cannot collect fractions. */
  amountCents: number;
  /** 2547XXXXXXXX */
  phone: string;
  /** Shown on the customer's statement (max 12 characters). */
  accountReference: string;
  /** Max 13 characters. */
  description: string;
};

export type StkPushResult = { merchantRequestId: string; checkoutRequestId: string; customerMessage: string };

/**
 * "pending": Safaricom is still waiting for the customer.
 * "success" / "failed": final. resultCode 0 is success; 1032 = cancelled by the customer,
 * 1 = insufficient funds, 2001 = wrong PIN, 1037 = the phone never answered (timeout).
 */
export type StkQueryResult =
  | { status: "pending" }
  | { status: "success" | "failed"; resultCode: number; resultDesc: string };

export interface MpesaGateway {
  stkPush(input: StkPushInput): Promise<StkPushResult>;
  stkQuery(checkoutRequestId: string): Promise<StkQueryResult>;
}

// ---- Daraja HTTP client ---------------------------------------------------------------------------

export type DarajaConfig = {
  baseUrl: string;
  consumerKey: string;
  consumerSecret: string;
  shortcode: string;
  passkey: string;
  callbackUrl: string;
};

const SANDBOX_URL = "https://sandbox.safaricom.co.ke";

const tokenResponse = z.object({ access_token: z.string().min(1), expires_in: z.coerce.number().default(3599) });
const pushResponse = z.object({
  MerchantRequestID: z.string(),
  CheckoutRequestID: z.string(),
  ResponseCode: z.coerce.string(),
  CustomerMessage: z.string().optional(),
  ResponseDescription: z.string().optional(),
});
const queryResponse = z.object({ ResultCode: z.coerce.number(), ResultDesc: z.string().optional() });
const errorResponse = z.object({ errorCode: z.string().optional(), errorMessage: z.string().optional() });

/** Daraja answers "still processing" with this error code rather than a result. */
const STILL_PROCESSING = "500.001.1001";

export function createDarajaClient(
  config: DarajaConfig,
  deps: { fetch?: typeof fetch; now?: () => Date } = {},
): MpesaGateway {
  const doFetch = deps.fetch ?? fetch;
  const now = deps.now ?? (() => new Date());
  let token: { value: string; expiresAt: number } | null = null;

  async function accessToken(force = false): Promise<string> {
    if (!force && token && token.expiresAt > now().getTime()) return token.value;
    const basic = Buffer.from(`${config.consumerKey}:${config.consumerSecret}`).toString("base64");
    const res = await doFetch(`${config.baseUrl}/oauth/v1/generate?grant_type=client_credentials`, {
      headers: { Authorization: `Basic ${basic}` },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new MpesaError();
    const parsed = tokenResponse.safeParse(await res.json().catch(() => null));
    if (!parsed.success) throw new MpesaError();
    // Refresh a minute early so a token never expires mid-request.
    token = { value: parsed.data.access_token, expiresAt: now().getTime() + (parsed.data.expires_in - 60) * 1000 };
    return token.value;
  }

  /** POST with the bearer token; a 401 means the cached token went stale, so refresh and retry once. */
  async function post(path: string, body: unknown): Promise<Response> {
    const send = async (t: string) =>
      doFetch(`${config.baseUrl}${path}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${t}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(20_000),
      });
    let res = await send(await accessToken());
    if (res.status === 401) res = await send(await accessToken(true));
    return res;
  }

  /** Daraja's timestamp (YYYYMMDDHHmmss, Nairobi time) and the password derived from it. */
  function stamp() {
    const timestamp = formatInTimeZone(now(), "Africa/Nairobi", "yyyyMMddHHmmss");
    const password = Buffer.from(`${config.shortcode}${config.passkey}${timestamp}`).toString("base64");
    return { timestamp, password };
  }

  return {
    async stkPush(input) {
      if (input.amountCents % 100 !== 0 || input.amountCents < 100) throw new MpesaError("Amount must be whole shillings.");
      const { timestamp, password } = stamp();
      let res: Response;
      try {
        res = await post("/mpesa/stkpush/v1/processrequest", {
          BusinessShortCode: config.shortcode,
          Password: password,
          Timestamp: timestamp,
          TransactionType: "CustomerPayBillOnline",
          Amount: input.amountCents / 100,
          PartyA: input.phone,
          PartyB: config.shortcode,
          PhoneNumber: input.phone,
          CallBackURL: config.callbackUrl,
          AccountReference: input.accountReference.slice(0, 12),
          TransactionDesc: input.description.slice(0, 13),
        });
      } catch {
        throw new MpesaError();
      }
      const json = await res.json().catch(() => null);
      const parsed = pushResponse.safeParse(json);
      if (!res.ok || !parsed.success || parsed.data.ResponseCode !== "0") {
        console.error("STK push rejected", res.status, JSON.stringify(json)?.slice(0, 300));
        throw new MpesaError("M-Pesa couldn't send the payment prompt. Check the number and try again.");
      }
      return {
        merchantRequestId: parsed.data.MerchantRequestID,
        checkoutRequestId: parsed.data.CheckoutRequestID,
        customerMessage: parsed.data.CustomerMessage ?? "Check your phone and enter your M-Pesa PIN.",
      };
    },

    async stkQuery(checkoutRequestId) {
      const { timestamp, password } = stamp();
      let res: Response;
      try {
        res = await post("/mpesa/stkpushquery/v1/query", {
          BusinessShortCode: config.shortcode,
          Password: password,
          Timestamp: timestamp,
          CheckoutRequestID: checkoutRequestId,
        });
      } catch {
        throw new MpesaError();
      }
      const json = await res.json().catch(() => null);
      const parsed = queryResponse.safeParse(json);
      if (parsed.success) {
        const { ResultCode: resultCode, ResultDesc: resultDesc = "" } = parsed.data;
        return { status: resultCode === 0 ? "success" : "failed", resultCode, resultDesc };
      }
      if (errorResponse.safeParse(json).data?.errorCode === STILL_PROCESSING) return { status: "pending" };
      throw new MpesaError();
    },
  };
}

// ---- which gateway is active ----------------------------------------------------------------------

export function mpesaCallbackUrl(): string {
  const secret = env.MPESA_CALLBACK_SECRET;
  if (!secret) throw new MpesaNotConfiguredError();
  const base = (env.MPESA_CALLBACK_BASE_URL ?? env.APP_URL).replace(/\/$/, "");
  return `${base}/api/webhooks/mpesa/${secret}`;
}

const hasDarajaCredentials = () =>
  Boolean(env.MPESA_CONSUMER_KEY && env.MPESA_CONSUMER_SECRET && env.MPESA_SHORTCODE && env.MPESA_PASSKEY && env.MPESA_CALLBACK_SECRET);

/** True when payments can actually be taken (real sandbox credentials, or the dev simulator). */
export function isMpesaConfigured(): boolean {
  if (env.MPESA_MODE === "simulator") return process.env.NODE_ENV !== "production" && Boolean(env.MPESA_CALLBACK_SECRET);
  return hasDarajaCredentials();
}

let gateway: MpesaGateway | undefined;

export async function getMpesa(): Promise<MpesaGateway> {
  if (gateway) return gateway;
  if (!isMpesaConfigured()) throw new MpesaNotConfiguredError();

  if (env.MPESA_MODE === "simulator") {
    const { createSimulatorGateway } = await import("@/lib/mpesa-simulator");
    return (gateway = createSimulatorGateway({ callbackUrl: mpesaCallbackUrl }));
  }
  if (env.MPESA_ENV !== "sandbox") {
    throw new Error("Openchair is test-mode only: MPESA_ENV must be \"sandbox\".");
  }
  return (gateway = createDarajaClient({
    baseUrl: SANDBOX_URL,
    consumerKey: env.MPESA_CONSUMER_KEY!,
    consumerSecret: env.MPESA_CONSUMER_SECRET!,
    shortcode: env.MPESA_SHORTCODE!,
    passkey: env.MPESA_PASSKEY!,
    callbackUrl: mpesaCallbackUrl(),
  }));
}
