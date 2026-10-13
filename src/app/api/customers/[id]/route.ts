import { handle } from "@/lib/http";
import * as customerService from "@/services/customer.service";
import { requireApiTenantContext } from "@/services/session.service";

export async function GET(_req: Request, route: RouteContext<"/api/customers/[id]">) {
  return handle(async () => {
    const { id } = await route.params;
    const ctx = await requireApiTenantContext("customers:read");
    return Response.json(await customerService.getCustomer(ctx, id));
  });
}
