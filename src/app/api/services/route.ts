import { handle } from "@/lib/http";
import * as catalogService from "@/services/catalog.service";
import { requireApiTenantContext } from "@/services/session.service";

export async function GET() {
  return handle(async () => {
    const ctx = await requireApiTenantContext("services:read");
    return Response.json(await catalogService.listServices(ctx));
  });
}
