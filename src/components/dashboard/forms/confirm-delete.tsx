"use client";

import { useState, useTransition } from "react";
import { FormError } from "@/components/form-error";
import { Button } from "@/components/ui/button";
import type { ActionResult } from "@/lib/action-result";

/**
 * Destructive action with an in-page confirmation step (no browser dialogs).
 * `action` is a server action; on success it redirects or refreshes the page.
 */
export function ConfirmDeleteButton({
  action,
  label = "Delete",
  confirmLabel = "Yes, delete",
  askFirst = true,
}: {
  action: () => Promise<ActionResult>;
  label?: string;
  confirmLabel?: string;
  askFirst?: boolean;
}) {
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string>();
  const [pending, start] = useTransition();

  const run = () =>
    start(async () => {
      const result = await action();
      if (!result.ok) {
        setError(result.error);
        setConfirming(false);
      }
    });

  return (
    <div className="grid gap-2">
      <FormError message={error} />
      {askFirst && !confirming ? (
        <Button type="button" variant="outline" size="sm" onClick={() => setConfirming(true)}>
          {label}
        </Button>
      ) : (
        <div className="flex gap-2">
          <Button type="button" variant="destructive" size="sm" disabled={pending} onClick={run}>
            {pending ? "Working…" : askFirst ? confirmLabel : label}
          </Button>
          {askFirst && (
            <Button type="button" variant="ghost" size="sm" disabled={pending} onClick={() => setConfirming(false)}>
              Cancel
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
