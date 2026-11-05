"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { toActionError, type ActionResult } from "@/lib/action-result";
import { confirmationPath } from "@/lib/booking-links";
import { clientIpFrom } from "@/lib/client-ip";
import { field } from "@/lib/form-data";
import * as publicBooking from "@/services/public-booking.service";
import { createPublicBookingInput } from "@/validators/booking";

// Public (no login). Thin: validate -> service -> redirect. Throttled by client IP inside the service.
export async function createBookingAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const slug = field(formData, "tenantSlug");
  let token: string;
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
    ({ publicToken: token } = await publicBooking.createBooking(input, { clientKey: clientIpFrom(await headers()) }));
  } catch (e) {
    return toActionError(e);
  }
  redirect(confirmationPath(slug, token));
}
