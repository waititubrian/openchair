"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { toActionError, type ActionResult } from "@/lib/action-result";
import { confirmationPath } from "@/lib/booking-links";
import { clientIpFrom } from "@/lib/client-ip";
import { field } from "@/lib/form-data";
import * as paymentService from "@/services/payment.service";
import * as publicBooking from "@/services/public-booking.service";
import { createPublicBookingInput } from "@/validators/booking";

// Public (no login). Thin: validate -> service -> redirect. Throttled by client IP inside the service.
export async function createBookingAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const slug = field(formData, "tenantSlug");
  let token: string;
  let status: string;
  try {
    const input = createPublicBookingInput.parse({
      tenantSlug: slug,
      serviceId: field(formData, "serviceId"),
      staff: field(formData, "staff") || "any",
      startsAt: field(formData, "startsAt"),
      name: field(formData, "name"),
      email: field(formData, "email"),
      phone: field(formData, "phone"),
      website: field(formData, "website"),
    });
    ({ publicToken: token, status } = await publicBooking.createBooking(input, { clientKey: clientIpFrom(await headers()) }));
  } catch (e) {
    return toActionError(e);
  }
  // A deposit is due: hand the customer to Stripe's hosted payment page. If Stripe can't be reached
  // the time stays held and the confirmation page offers a "Pay deposit" button to try again.
  if (status === "PENDING_PAYMENT") {
    let checkoutUrl: string | null = null;
    try {
      checkoutUrl = (await paymentService.startDepositCheckout(slug, token)).url;
    } catch (e) {
      console.error("could not start deposit checkout", e);
    }
    if (checkoutUrl) redirect(checkoutUrl);
  }
  redirect(confirmationPath(slug, token));
}

/** "Pay deposit" on the confirmation page: reuse the open payment session or create a new one. */
export async function payDepositAction(slug: string, token: string): Promise<ActionResult> {
  let url: string;
  try {
    ({ url } = await paymentService.startDepositCheckout(slug, token));
  } catch (e) {
    return toActionError(e);
  }
  redirect(url);
}
