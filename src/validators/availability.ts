import { z } from "zod";

const rule = z
  .object({
    dayOfWeek: z.number().int().min(0).max(6),
    startMinute: z.number().int().min(0).max(1440),
    endMinute: z.number().int().min(0).max(1440),
  })
  .refine((r) => r.endMinute > r.startMinute, { path: ["endMinute"], message: "Closing must be after opening" });

/** A whole weekly schedule (replaces the existing one). Empty = not available at all. */
export const weeklyRulesInput = z
  .array(rule)
  .max(28)
  .refine((rules) => {
    // No two intervals on the same day may overlap.
    const byDay = new Map<number, [number, number][]>();
    for (const r of rules) byDay.set(r.dayOfWeek, [...(byDay.get(r.dayOfWeek) ?? []), [r.startMinute, r.endMinute]]);
    return [...byDay.values()].every((iv) => {
      const sorted = [...iv].sort((a, b) => a[0] - b[0]);
      return sorted.every((cur, i) => i === 0 || cur[0] >= sorted[i - 1][1]);
    });
  }, "Hours on the same day can't overlap");

export const timeOffInput = z
  .object({
    startsAt: z.iso.datetime({ offset: true }),
    endsAt: z.iso.datetime({ offset: true }),
    reason: z.string().trim().max(200).optional(),
  })
  .refine((t) => new Date(t.endsAt) > new Date(t.startsAt), { path: ["endsAt"], message: "End must be after start" });

export type WeeklyRulesInput = z.infer<typeof weeklyRulesInput>;
export type TimeOffInput = z.infer<typeof timeOffInput>;
