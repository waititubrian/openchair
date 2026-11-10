import { z } from "zod";

// Safaricom's STK Push callback. Only the fields we use are validated (extra fields are ignored).
// On success CallbackMetadata.Item carries Amount, MpesaReceiptNumber, TransactionDate, PhoneNumber;
// on failure it is absent and only the Result* fields are guaranteed.
export const stkCallbackBody = z.object({
  Body: z.object({
    stkCallback: z.object({
      MerchantRequestID: z.string().min(1).max(100),
      CheckoutRequestID: z.string().min(1).max(100),
      ResultCode: z.coerce.number().int(),
      ResultDesc: z.string().max(500).default(""),
      CallbackMetadata: z
        .object({ Item: z.array(z.object({ Name: z.string(), Value: z.union([z.string(), z.number()]).optional() })).max(20) })
        .optional(),
    }),
  }),
});

export type StkCallbackBody = z.infer<typeof stkCallbackBody>;

/** Pull the named values out of CallbackMetadata. */
export function callbackDetails(body: StkCallbackBody) {
  const items = body.Body.stkCallback.CallbackMetadata?.Item ?? [];
  const value = (name: string) => items.find((i) => i.Name === name)?.Value;
  const amount = value("Amount");
  const receipt = value("MpesaReceiptNumber");
  return {
    amountCents: typeof amount === "number" ? Math.round(amount * 100) : null,
    receipt: typeof receipt === "string" && receipt.length > 0 ? receipt : null,
  };
}

/** A phone number typed into a payment form. */
export const payPhoneInput = z.object({ phone: z.string().trim().min(1, "Enter your M-Pesa number").max(20) });
