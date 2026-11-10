import { describe, expect, it } from "vitest";
import { MpesaError } from "@/lib/errors";
import { createDarajaClient, type DarajaConfig } from "@/lib/mpesa";

// The Daraja HTTP client against a FAKE fetch: we check exactly what would be sent to Safaricom.
const config: DarajaConfig = {
  baseUrl: "https://sandbox.example",
  consumerKey: "KEY",
  consumerSecret: "SECRET",
  shortcode: "174379",
  passkey: "PASSKEY",
  callbackUrl: "https://app.example/api/webhooks/mpesa/s3cr3t",
};

type Call = { url: string; init: RequestInit };
function fakeFetch(handler: (call: Call, n: number) => Response | Promise<Response> | "throw") {
  const calls: Call[] = [];
  const impl = (async (url: string, init: RequestInit = {}) => {
    const call = { url, init };
    calls.push(call);
    const r = handler(call, calls.length);
    if (r === "throw") throw new TypeError("network down");
    return r;
  }) as unknown as typeof fetch;
  return { impl, calls };
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const token = (n = 1, expires = 3599) => json({ access_token: `tok${n}`, expires_in: String(expires) });
const pushOk = { MerchantRequestID: "m-1", CheckoutRequestID: "ws_CO_1", ResponseCode: "0", ResponseDescription: "Success", CustomerMessage: "Success. Request accepted for processing" };
const bodyOf = (c: Call) => JSON.parse(String(c.init.body));
const NOW = new Date("2031-07-01T12:00:00Z"); // 15:00 in Nairobi

function pushFetch(extra?: (c: Call) => Response | undefined) {
  return fakeFetch((c) => (c.url.includes("/oauth/") ? token() : (extra?.(c) ?? json(pushOk))));
}

describe("OAuth token", () => {
  it("authenticates with Basic key:secret and caches the token across calls", async () => {
    const f = pushFetch();
    const client = createDarajaClient(config, { fetch: f.impl, now: () => NOW });
    await client.stkPush({ amountCents: 10_000, phone: "254712345678", accountReference: "A", description: "D" });
    await client.stkPush({ amountCents: 10_000, phone: "254712345678", accountReference: "A", description: "D" });
    const oauth = f.calls.filter((c) => c.url.includes("/oauth/"));
    expect(oauth).toHaveLength(1); // fetched once, reused
    expect(oauth[0].url).toBe("https://sandbox.example/oauth/v1/generate?grant_type=client_credentials");
    expect((oauth[0].init.headers as Record<string, string>).Authorization).toBe(`Basic ${Buffer.from("KEY:SECRET").toString("base64")}`);
    const push = f.calls.find((c) => c.url.includes("processrequest"))!;
    expect((push.init.headers as Record<string, string>).Authorization).toBe("Bearer tok1");
  });

  it("fetches a new token once the cached one is about to expire", async () => {
    let clock = NOW.getTime();
    let n = 0;
    const f = fakeFetch((c) => (c.url.includes("/oauth/") ? token(++n, 3599) : json(pushOk)));
    const client = createDarajaClient(config, { fetch: f.impl, now: () => new Date(clock) });
    const push = () => client.stkPush({ amountCents: 10_000, phone: "254712345678", accountReference: "A", description: "D" });
    await push();
    clock += 3000 * 1000; // 50 minutes later: still valid
    await push();
    clock += 600 * 1000; // past (3599 - 60)s: refreshed
    await push();
    expect(f.calls.filter((c) => c.url.includes("/oauth/"))).toHaveLength(2);
  });

  it("a 401 from the API means the token went stale: refresh and retry ONCE", async () => {
    let n = 0;
    const f = fakeFetch((c) => {
      if (c.url.includes("/oauth/")) return token(++n);
      return (c.init.headers as Record<string, string>).Authorization === "Bearer tok1" ? json({ errorCode: "401.003.01" }, 401) : json(pushOk);
    });
    const client = createDarajaClient(config, { fetch: f.impl, now: () => NOW });
    const r = await client.stkPush({ amountCents: 10_000, phone: "254712345678", accountReference: "A", description: "D" });
    expect(r.checkoutRequestId).toBe("ws_CO_1");
    expect(f.calls.filter((c) => c.url.includes("processrequest"))).toHaveLength(2);
  });

  it("fails cleanly when authentication fails", async () => {
    const f = fakeFetch(() => json({ error: "bad" }, 400));
    const client = createDarajaClient(config, { fetch: f.impl, now: () => NOW });
    await expect(client.stkPush({ amountCents: 10_000, phone: "254712345678", accountReference: "A", description: "D" })).rejects.toBeInstanceOf(MpesaError);
  });
});

describe("STK Push", () => {
  it("sends the exact request Daraja expects", async () => {
    const f = pushFetch();
    const client = createDarajaClient(config, { fetch: f.impl, now: () => NOW });
    const r = await client.stkPush({ amountCents: 250_000, phone: "254712345678", accountReference: "OCPROSUBSCRIPTION", description: "Openchair Pro plan" });

    const call = f.calls.find((c) => c.url.includes("processrequest"))!;
    expect(call.url).toBe("https://sandbox.example/mpesa/stkpush/v1/processrequest");
    const body = bodyOf(call);
    expect(body).toMatchObject({
      BusinessShortCode: "174379",
      Timestamp: "20310701150000", // Nairobi time (UTC+3), not UTC
      TransactionType: "CustomerPayBillOnline",
      Amount: 2500, // whole shillings, a number
      PartyA: "254712345678",
      PartyB: "174379",
      PhoneNumber: "254712345678",
      CallBackURL: "https://app.example/api/webhooks/mpesa/s3cr3t",
    });
    expect(typeof body.Amount).toBe("number");
    // Password = base64(shortcode + passkey + timestamp)
    expect(body.Password).toBe(Buffer.from("174379PASSKEY20310701150000").toString("base64"));
    expect(body.AccountReference).toBe("OCPROSUBSCRI"); // truncated to Daraja's limits
    expect(body.AccountReference.length).toBeLessThanOrEqual(12);
    expect(body.TransactionDesc.length).toBeLessThanOrEqual(13);
    expect(r).toEqual({ merchantRequestId: "m-1", checkoutRequestId: "ws_CO_1", customerMessage: "Success. Request accepted for processing" });
  });

  it("refuses fractional-shilling and sub-shilling amounts BEFORE any network call", async () => {
    const f = pushFetch();
    const client = createDarajaClient(config, { fetch: f.impl, now: () => NOW });
    for (const amountCents of [10_050, 50, 0, -100]) {
      await expect(client.stkPush({ amountCents, phone: "254712345678", accountReference: "A", description: "D" }), String(amountCents)).rejects.toBeInstanceOf(MpesaError);
    }
    expect(f.calls).toHaveLength(0);
  });

  it("turns Safaricom rejections, HTTP errors, malformed bodies and network failures into MpesaError", async () => {
    const attempt = (handler: Parameters<typeof pushFetch>[0]) =>
      createDarajaClient(config, { fetch: pushFetch(handler).impl, now: () => NOW }).stkPush({ amountCents: 10_000, phone: "254712345678", accountReference: "A", description: "D" });
    await expect(attempt(() => json({ ...pushOk, ResponseCode: "1" }))).rejects.toBeInstanceOf(MpesaError);
    await expect(attempt(() => json({ errorCode: "400.002.02", errorMessage: "Bad Request - Invalid PhoneNumber" }, 400))).rejects.toBeInstanceOf(MpesaError);
    await expect(attempt(() => json({ nonsense: true }))).rejects.toBeInstanceOf(MpesaError);
    await expect(attempt(() => new Response("<html>gateway</html>", { status: 502 }))).rejects.toBeInstanceOf(MpesaError);
    const down = fakeFetch((c) => (c.url.includes("/oauth/") ? token() : "throw"));
    await expect(createDarajaClient(config, { fetch: down.impl, now: () => NOW }).stkPush({ amountCents: 10_000, phone: "254712345678", accountReference: "A", description: "D" })).rejects.toBeInstanceOf(MpesaError);
  });
});

describe("STK query", () => {
  const query = (handler: (c: Call) => Response) => {
    const f = fakeFetch((c) => (c.url.includes("/oauth/") ? token() : handler(c)));
    return { f, client: createDarajaClient(config, { fetch: f.impl, now: () => NOW }) };
  };

  it("asks about one CheckoutRequestID with the same password scheme", async () => {
    const { f, client } = query(() => json({ ResponseCode: "0", ResultCode: "0", ResultDesc: "The service request is processed successfully." }));
    await client.stkQuery("ws_CO_9");
    const call = f.calls.find((c) => c.url.includes("stkpushquery"))!;
    expect(call.url).toBe("https://sandbox.example/mpesa/stkpushquery/v1/query");
    expect(bodyOf(call)).toMatchObject({ BusinessShortCode: "174379", CheckoutRequestID: "ws_CO_9", Timestamp: "20310701150000" });
    expect(bodyOf(call).Password).toBe(Buffer.from("174379PASSKEY20310701150000").toString("base64"));
  });

  it("ResultCode 0 is success; any other code is a final failure with its code and text", async () => {
    expect(await query(() => json({ ResultCode: "0", ResultDesc: "ok" })).client.stkQuery("c")).toEqual({ status: "success", resultCode: 0, resultDesc: "ok" });
    expect(await query(() => json({ ResultCode: "1032", ResultDesc: "Request cancelled by user" })).client.stkQuery("c")).toEqual({ status: "failed", resultCode: 1032, resultDesc: "Request cancelled by user" });
    expect(await query(() => json({ ResultCode: 1037, ResultDesc: "DS timeout" })).client.stkQuery("c")).toMatchObject({ status: "failed", resultCode: 1037 });
  });

  it("'still being processed' is PENDING, never a failure", async () => {
    const { client } = query(() => json({ requestId: "r", errorCode: "500.001.1001", errorMessage: "The transaction is being processed" }, 500));
    expect(await client.stkQuery("c")).toEqual({ status: "pending" });
  });

  it("anything else we can't understand is an error (we never guess a result)", async () => {
    await expect(query(() => json({ errorCode: "404.001.03", errorMessage: "Invalid Access Token" }, 404)).client.stkQuery("c")).rejects.toBeInstanceOf(MpesaError);
    await expect(query(() => new Response("oops", { status: 500 })).client.stkQuery("c")).rejects.toBeInstanceOf(MpesaError);
  });
});
