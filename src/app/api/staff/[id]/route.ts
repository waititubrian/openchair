import { handle, readJson } from "@/lib/http";
import * as staffService from "@/services/staff.service";
import { requireApiTenantContext } from "@/services/session.service";
import { updateStaffInput } from "@/validators/staff";

export async function GET(_req: Request, route: RouteContext<"/api/staff/[id]">) {
  return handle(async () => {
    const { id } = await route.params;
    const ctx = await requireApiTenantContext("staff:read");
    return Response.json(await staffService.getStaffMember(ctx, id));
  });
}

// OWNER only (staff:write).
export async function PATCH(req: Request, route: RouteContext<"/api/staff/[id]">) {
  return handle(async () => {
    const { id } = await route.params;
    const ctx = await requireApiTenantContext("staff:write");
    const patch = updateStaffInput.parse(await readJson(req));
    return Response.json(await staffService.updateStaffMember(ctx, id, patch));
  });
}

// OWNER only. Refused (409) if the person has bookings; deactivate them instead.
export async function DELETE(_req: Request, route: RouteContext<"/api/staff/[id]">) {
  return handle(async () => {
    const { id } = await route.params;
    const ctx = await requireApiTenantContext("staff:write");
    await staffService.deleteStaffMember(ctx, id);
    return new Response(null, { status: 204 });
  });
}
