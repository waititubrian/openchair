"use server";

import { revalidatePath, refresh } from "next/cache";
import { redirect } from "next/navigation";
import { toActionError, type ActionResult } from "@/lib/action-result";
import { field, fields } from "@/lib/form-data";
import * as availabilityService from "@/services/availability.service";
import { requireTenantContext } from "@/services/session.service";
import * as staffService from "@/services/staff.service";
import { timeOffFormInput, weeklyHoursFormInput } from "@/validators/availability";
import { staffFormInput } from "@/validators/staff";

// Staff profile actions are OWNER-only (staff:write). Schedule actions need availability:write,
// and the service additionally checks "your own schedule unless you are the OWNER".

function readStaffForm(fd: FormData) {
  return staffFormInput.parse({
    name: field(fd, "name"),
    active: fd.get("active") === "on",
    serviceIds: fields(fd, "serviceIds"),
  });
}

export async function createStaffAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const ctx = await requireTenantContext("staff:write");
  try {
    const { name, serviceIds } = readStaffForm(formData);
    await staffService.createStaffMember(ctx, { name, serviceIds });
  } catch (e) {
    return toActionError(e);
  }
  revalidatePath("/dashboard", "layout");
  redirect("/dashboard/staff");
}

export async function updateStaffAction(
  staffId: string,
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const ctx = await requireTenantContext("staff:write");
  try {
    await staffService.updateStaffMember(ctx, staffId, readStaffForm(formData));
  } catch (e) {
    return toActionError(e);
  }
  refresh();
  return { ok: true };
}

export async function deleteStaffAction(staffId: string): Promise<ActionResult> {
  const ctx = await requireTenantContext("staff:write");
  try {
    await staffService.deleteStaffMember(ctx, staffId);
  } catch (e) {
    return toActionError(e);
  }
  revalidatePath("/dashboard", "layout");
  redirect("/dashboard/staff");
}

export async function saveHoursAction(
  staffId: string,
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const ctx = await requireTenantContext("availability:write");
  try {
    const rules = weeklyHoursFormInput.parse(JSON.parse(field(formData, "hours") || "[]"));
    await availabilityService.replaceWeekly(ctx, staffId, rules);
  } catch (e) {
    return toActionError(e);
  }
  refresh();
  return { ok: true };
}

export async function addTimeOffAction(
  staffId: string,
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const ctx = await requireTenantContext("availability:write");
  try {
    const input = timeOffFormInput.parse({
      startLocal: field(formData, "startLocal"),
      endLocal: field(formData, "endLocal"),
      reason: field(formData, "reason"),
    });
    await availabilityService.addTimeOffLocal(ctx, staffId, input);
  } catch (e) {
    return toActionError(e);
  }
  refresh();
  return { ok: true };
}

export async function removeTimeOffAction(timeOffId: string): Promise<ActionResult> {
  const ctx = await requireTenantContext("availability:write");
  try {
    await availabilityService.removeTimeOff(ctx, timeOffId);
  } catch (e) {
    return toActionError(e);
  }
  refresh();
  return { ok: true };
}
