import { unstable_rethrow } from "next/navigation";
import { z } from "zod";
import { AppError } from "@/lib/errors";

// Route handlers stay thin: they wrap their body in handle() and let services throw.
// This is the one place errors become HTTP responses.
export function toErrorResponse(e: unknown): Response {
  if (e instanceof z.ZodError) {
    const fieldErrors: Record<string, string[]> = {};
    for (const issue of e.issues) (fieldErrors[issue.path.join(".")] ??= []).push(issue.message);
    return Response.json({ error: "Invalid input", code: "VALIDATION", fieldErrors }, { status: 400 });
  }
  if (e instanceof AppError) return Response.json({ error: e.message, code: e.code }, { status: e.status });
  console.error(e);
  return Response.json({ error: "Internal error", code: "INTERNAL" }, { status: 500 });
}

export async function handle(fn: () => Promise<Response>): Promise<Response> {
  try {
    return await fn();
  } catch (e) {
    // Next signals "this reads request data" (headers()/cookies() during prerender) and
    // redirect/notFound by throwing. Those must reach Next, not become a 500 response.
    unstable_rethrow(e);
    return toErrorResponse(e);
  }
}

/** Parse a JSON body; invalid/missing JSON becomes `undefined` so Zod reports a clean 400. */
export async function readJson(req: Request): Promise<unknown> {
  return req.json().catch(() => undefined);
}
