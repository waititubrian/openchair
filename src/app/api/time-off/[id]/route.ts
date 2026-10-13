import { handle } from "@/lib/http";
import * as availabilityService from "@/services/availability.service";
import { requireApiTenantContext } from "@/services/session.service";

export async function DELETE(_req: Request, route: RouteContext<"/api/time-off/[id]">) {
  return handle(async () => {
    const { id } = await route.params;
    const ctx = await requireApiTenantContext("availability:write");
    await availabilityService.removeTimeOff(ctx, id);
    return new Response(null, { status: 204 });
  });
}
