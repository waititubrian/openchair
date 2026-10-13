import { handle, readJson } from "@/lib/http";
import { requireApiTenantContext } from "@/services/session.service";
import * as tenantService from "@/services/tenant.service";
import { updateSettingsInput } from "@/validators/settings";

// OWNER only.
export async function GET() {
  return handle(async () => {
    const ctx = await requireApiTenantContext("settings:manage");
    return Response.json(await tenantService.getSettings(ctx));
  });
}

export async function PATCH(req: Request) {
  return handle(async () => {
    const ctx = await requireApiTenantContext("settings:manage");
    const patch = updateSettingsInput.parse(await readJson(req));
    return Response.json(await tenantService.updateSettings(ctx, patch));
  });
}
