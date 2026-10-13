import { z } from "zod";
import { AppError } from "@/lib/errors";

// What every server action returns to its form. Thin actions: validate -> service -> result.
export type ActionResult<T = undefined> =
  | { ok: true; data?: T }
  | {
      ok: false;
      error: string;
      fieldErrors?: Record<string, string[] | undefined>;
      /** Non-secret submitted values, echoed back because React resets the form after an action. */
      values?: Record<string, string>;
    };

/** Convert anything thrown by validation or a service into an ActionResult. */
export function toActionError(e: unknown): Extract<ActionResult, { ok: false }> {
  if (e instanceof z.ZodError) {
    // Key by full path ("service.price") so nested form fields can show their own error.
    const fieldErrors: Record<string, string[]> = {};
    for (const issue of e.issues) {
      const key = issue.path.join(".");
      (fieldErrors[key] ??= []).push(issue.message);
    }
    return { ok: false, error: "Please fix the highlighted fields.", fieldErrors };
  }
  if (e instanceof AppError) return { ok: false, error: e.message };
  console.error(e);
  return { ok: false, error: "Something went wrong. Please try again." };
}
