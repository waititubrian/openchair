"use server";

import { refresh } from "next/cache";
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
  // A deposit is due: send the M-Pesa prompt now. If it can't be sent (M-Pesa unreachable, a mistyped
  // number) the time stays held and the confirmation page lets the customer send it again.
  if (status === "PENDING_PAYMENT") {
    try {
      await paymentService.startDepositPayment(slug, token, field(formData, "phone"));
    } catch (e) {
      console.error("could not send the deposit prompt", e);
    }
  }
  redirect(confirmationPath(slug, token));
}

/** "Send prompt again" on the confirmation page (a different number is allowed). */
export async function payDepositAction(slug: string, token: string, _prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  try {
    await paymentService.startDepositPayment(slug, token, field(formData, "phone"));
  } catch (e) {
    return toActionError(e);
  }
  refresh();
  return { ok: true };
}
