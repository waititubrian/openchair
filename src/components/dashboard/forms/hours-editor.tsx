"use client";

import { useActionState, useState } from "react";
import { FormError } from "@/components/form-error";
import { Button } from "@/components/ui/button";
import type { ActionResult } from "@/lib/action-result";
import { DAY_NAMES, minutesToHhmm } from "@/lib/time";
import { SaveStatus } from "./save-status";

type Interval = { start: string; end: string };
export type WeeklyRule = { dayOfWeek: number; startMinute: number; endMinute: number };

const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0]; // Monday first; values are JS day numbers (0 = Sunday)

function toDays(rules: WeeklyRule[]): Interval[][] {
  const days: Interval[][] = Array.from({ length: 7 }, () => []);
  for (const r of rules) days[r.dayOfWeek].push({ start: minutesToHhmm(r.startMinute), end: minutesToHhmm(r.endMinute) });
  return days;
}

/** Several intervals per day (split shifts). A day with none is "Closed". */
export function HoursEditor({
  action,
  initial,
}: {
  action: (prev: ActionResult | null, formData: FormData) => Promise<ActionResult>;
  initial: WeeklyRule[];
}) {
  const [state, formAction, pending] = useActionState(action, null);
  const [days, setDays] = useState<Interval[][]>(() => toDays(initial));
  const fieldErrors = state && !state.ok ? state.fieldErrors : undefined;

  const hours = JSON.stringify(
    WEEK_ORDER.flatMap((d) => days[d].map((iv) => ({ dayOfWeek: d, start: iv.start, end: iv.end }))),
  );
  const update = (d: number, fn: (list: Interval[]) => Interval[]) =>
    setDays((all) => all.map((list, i) => (i === d ? fn(list) : list)));

  return (
    <form action={formAction} className="grid gap-3">
      <input type="hidden" name="hours" value={hours} />
      {state && !state.ok && <FormError message={Object.values(fieldErrors ?? {}).flat()[0] ?? state.error} />}
      {WEEK_ORDER.map((d) => (
        <div key={d} className="flex flex-wrap items-start gap-3 border-b pb-3 last:border-b-0">
          <span className="w-28 pt-2 text-sm font-medium">{DAY_NAMES[d]}</span>
          <div className="grid gap-2">
            {days[d].length === 0 && <span className="pt-2 text-sm text-muted-foreground">Closed</span>}
            {days[d].map((iv, i) => (
              <div key={i} className="flex items-center gap-2">
                <input
                  type="time"
                  aria-label={`${DAY_NAMES[d]} opens, interval ${i + 1}`}
                  value={iv.start}
                  onChange={(e) => update(d, (l) => l.map((x, j) => (j === i ? { ...x, start: e.target.value } : x)))}
                  className="h-9 rounded-md border border-input bg-transparent px-2 text-sm"
                />
                <span aria-hidden>–</span>
                <input
                  type="time"
                  aria-label={`${DAY_NAMES[d]} closes, interval ${i + 1}`}
                  value={iv.end}
                  onChange={(e) => update(d, (l) => l.map((x, j) => (j === i ? { ...x, end: e.target.value } : x)))}
                  className="h-9 rounded-md border border-input bg-transparent px-2 text-sm"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  aria-label={`Remove ${DAY_NAMES[d]} interval ${i + 1}`}
                  onClick={() => update(d, (l) => l.filter((_, j) => j !== i))}
                >
                  Remove
                </Button>
              </div>
            ))}
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="w-fit"
              aria-label={days[d].length ? `Add hours on ${DAY_NAMES[d]}` : `Open ${DAY_NAMES[d]}`}
              onClick={() =>
                update(d, (l) => [...l, l.length ? { start: l[l.length - 1].end, end: "17:00" } : { start: "09:00", end: "17:00" }])
              }
            >
              {days[d].length ? "Add hours" : `Open ${DAY_NAMES[d]}`}
            </Button>
          </div>
        </div>
      ))}
      <div className="flex items-center gap-4">
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : "Save weekly hours"}
        </Button>
        <SaveStatus state={state && state.ok ? state : null} />
      </div>
    </form>
  );
}
