"use server";

import { revalidatePath, refresh } from "next/cache";
import { redirect } from "next/navigation";
import { toActionError, type ActionResult } from "@/lib/action-result";
import { field, fields } from "@/lib/form-data";
import * as catalogService from "@/services/catalog.service";
import { requireTenantContext } from "@/services/session.service";
import { serviceFormInput } from "@/validators/catalog";

// Thin: authenticate (+ permission) -> validate -> service -> result. requireTenantContext
// redirects, so it stays outside try/catch (redirect works by throwing).

function readServiceForm(fd: FormData) {
  return serviceFormInput.parse({
    name: field(fd, "name"),
    description: field(fd, "description"),
    durationMin: field(fd, "durationMin"),
    price: field(fd, "price"),
    deposit: field(fd, "deposit"),
    active: fd.get("active") === "on",
    staffIds: fields(fd, "staffIds"),
  });
}

export async function createServiceAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const ctx = await requireTenantContext("services:write");
  try {
    await catalogService.createService(ctx, readServiceForm(formData));
  } catch (e) {
    return toActionError(e);
  }
  revalidatePath("/dashboard", "layout");
  redirect("/dashboard/services");
}

export async function updateServiceAction(
  serviceId: string,
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const ctx = await requireTenantContext("services:write");
  try {
    await catalogService.updateService(ctx, serviceId, readServiceForm(formData));
  } catch (e) {
    return toActionError(e);
  }
  refresh();
  return { ok: true };
}

export async function deleteServiceAction(serviceId: string): Promise<ActionResult> {
  const ctx = await requireTenantContext("services:write");
  try {
    await catalogService.deleteService(ctx, serviceId);
  } catch (e) {
    return toActionError(e);
  }
  revalidatePath("/dashboard", "layout");
  redirect("/dashboard/services");
}
