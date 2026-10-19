import { FormError } from "@/components/form-error";
import type { ActionResult } from "@/lib/action-result";

/** Shows the last action's error, or "Saved" after a successful in-place save. */
export function SaveStatus({ state }: { state: ActionResult | null }) {
  if (!state) return null;
  if (!state.ok) return <FormError message={state.error} />;
  return (
    <p role="status" className="text-sm text-green-700 dark:text-green-400">
      Saved
    </p>
  );
}
