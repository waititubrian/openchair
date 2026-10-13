import { handle, readJson } from "@/lib/http";
import * as catalogService from "@/services/catalog.service";
import { requireApiTenantContext } from "@/services/session.service";
import { updateServiceInput } from "@/validators/catalog";

export async function GET(_req: Request, route: RouteContext<"/api/services/[id]">) {
  return handle(async () => {
    const { id } = await route.params;
    const ctx = await requireApiTenantContext("services:read");
    return Response.json(await catalogService.getService(ctx, id));
  });
}

// OWNER only: requireApiTenantContext("services:write") answers 403 for STAFF.
export async function PATCH(req: Request, route: RouteContext<"/api/services/[id]">) {
  return handle(async () => {
    const { id } = await route.params;
    const ctx = await requireApiTenantContext("services:write");
    const patch = updateServiceInput.parse(await readJson(req));
    return Response.json(await catalogService.updateService(ctx, id, patch));
  });
}
