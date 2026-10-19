"use client";

import { useActionState, useEffect, useId, useRef, useState, useSyncExternalStore } from "react";
import { FormError } from "@/components/form-error";
import { FormField } from "@/components/form-field";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import type { ActionResult } from "@/lib/action-result";
import { DAY_NAMES, listTimeZones } from "@/lib/time";
import { checkSlugAction, onboardAction } from "./actions";

type Day = { enabled: boolean; start: string; end: string };
type SlugState = { status: "idle" | "checking" | "ok" | "bad"; message?: string };

// Display order Monday..Sunday; values are JS-style day numbers (0 = Sunday).
const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];
const defaultHours = (): Day[] =>
  Array.from({ length: 7 }, (_, d) => ({ enabled: d >= 1 && d <= 5, start: "09:00", end: "17:00" }));

const slugify = (v: string) =>
  v.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);

const STEPS = ["Your shop", "First service", "Weekly hours"] as const;

export function OnboardingWizard({ firstName }: { firstName: string }) {
  const [step, setStep] = useState(0);
  const [shopName, setShopName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [slugState, setSlugState] = useState<SlugState>({ status: "idle" });
  // Browser timezone without an effect: the server snapshot is "" (no hydration mismatch),
  // the client snapshot is the visitor's real zone. The user's own choice overrides it.
  const browserTz = useSyncExternalStore(
    () => () => {},
    () => Intl.DateTimeFormat().resolvedOptions().timeZone,
    () => "",
  );
  const [tzChoice, setTzChoice] = useState<string | null>(null);
  const timezone = tzChoice ?? (browserTz || "America/New_York");
  const [timezones] = useState(listTimeZones);
  const [service, setService] = useState({ name: "Haircut", durationMin: "30", price: "35", deposit: "10" });
  const [hours, setHours] = useState<Day[]>(defaultHours);
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(onboardAction, null);
  const checkId = useRef(0);
  const timezoneId = useId();

  // Debounced "is this web address free?" check; stale responses are ignored.
  useEffect(() => {
    if (slug.length < 3) return;
    const id = ++checkId.current;
    const t = setTimeout(async () => {
      setSlugState({ status: "checking" });
      const res = await checkSlugAction(slug);
      if (id !== checkId.current) return;
      setSlugState(res.available ? { status: "ok" } : { status: "bad", message: res.reason });
    }, 400);
    return () => clearTimeout(t);
  }, [slug]);

  const errors = state && !state.ok ? state.fieldErrors : undefined;
  const firstErrorStep = errors
    ? Object.keys(errors).some((k) => k.startsWith("hours"))
      ? 2
      : Object.keys(errors).some((k) => k.startsWith("service"))
        ? 1
        : 0
    : null;

  const slugShown = slug.length >= 3 ? slugState : { status: "idle" as const };
  const step0Valid = shopName.trim().length >= 2 && slug.length >= 3 && slugShown.status !== "bad";
  const step1Valid = service.name.trim() !== "" && service.price.trim() !== "" && service.deposit.trim() !== "";

  const payload = JSON.stringify({
    shopName,
    slug,
    timezone,
    service: { ...service, durationMin: Number(service.durationMin) },
    hours: WEEK_ORDER.filter((d) => hours[d].enabled).map((d) => ({
      dayOfWeek: d,
      start: hours[d].start,
      end: hours[d].end,
    })),
  });

  const setDay = (d: number, patch: Partial<Day>) =>
    setHours((h) => h.map((x, i) => (i === d ? { ...x, ...patch } : x)));

  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight">Welcome, {firstName}. Let&apos;s set up your shop.</h1>
      <ol className="mt-4 flex gap-2 text-sm" aria-label="Progress">
        {STEPS.map((label, i) => (
          <li
            key={label}
            aria-current={i === step ? "step" : undefined}
            className={`rounded-full px-3 py-1 ${i === step ? "bg-foreground text-background" : "bg-muted text-muted-foreground"}`}
          >
            {i + 1}. {label}
          </li>
        ))}
      </ol>

      <form action={action} className="mt-6 grid gap-4">
        <input type="hidden" name="payload" value={payload} />
        <FormError message={state && !state.ok ? state.error : undefined} />
        {firstErrorStep !== null && firstErrorStep !== step && (
          <p className="text-sm text-red-600 dark:text-red-400">
            There&apos;s a problem on step {firstErrorStep + 1}.{" "}
            <button type="button" className="underline" onClick={() => setStep(firstErrorStep)}>
              Go there
            </button>
          </p>
        )}

        {step === 0 && (
          <>
            <FormField
              label="Shop name"
              value={shopName}
              onChange={(e) => {
                setShopName(e.target.value);
                if (!slugTouched) setSlug(slugify(e.target.value));
              }}
              errors={errors?.shopName}
              placeholder="Fade & Co"
            />
            <div className="grid gap-1.5">
              <FormField
                label="Your booking web address"
                value={slug}
                onChange={(e) => {
                  setSlugTouched(true);
                  setSlug(slugify(e.target.value));
                }}
                errors={errors?.slug ?? (slugShown.status === "bad" ? [slugShown.message ?? "Unavailable"] : undefined)}
                placeholder="fade-and-co"
              />
              <p className="text-xs text-muted-foreground" aria-live="polite">
                openchair.app/b/<strong>{slug || "your-shop"}</strong>{" "}
                {slugShown.status === "checking" && "· checking…"}
                {slugShown.status === "ok" && "· available ✓"}
              </p>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor={timezoneId}>Timezone</Label>
              <select
                id={timezoneId}
                value={timezone}
                onChange={(e) => setTzChoice(e.target.value)}
                className="h-9 rounded-md border border-input bg-transparent px-3 text-sm"
              >
                {timezones.map((tz) => (
                  <option key={tz} value={tz}>
                    {tz}
                  </option>
                ))}
              </select>
              <p className="text-xs text-muted-foreground">Your hours and customers&apos; times are shown in this timezone.</p>
            </div>
          </>
        )}

        {step === 1 && (
          <>
            <FormField
              label="Service name"
              value={service.name}
              onChange={(e) => setService({ ...service, name: e.target.value })}
              errors={errors?.["service.name"]}
            />
            <div className="grid grid-cols-3 gap-3">
              <FormField
                label="Minutes"
                inputMode="numeric"
                value={service.durationMin}
                onChange={(e) => setService({ ...service, durationMin: e.target.value })}
                errors={errors?.["service.durationMin"]}
              />
              <FormField
                label="Price ($)"
                inputMode="decimal"
                value={service.price}
                onChange={(e) => setService({ ...service, price: e.target.value })}
                errors={errors?.["service.price"]}
              />
              <FormField
                label="Deposit ($)"
                inputMode="decimal"
                value={service.deposit}
                onChange={(e) => setService({ ...service, deposit: e.target.value })}
                errors={errors?.["service.deposit"]}
              />
            </div>
            <p className="text-xs text-muted-foreground">
              Customers pay the deposit online to confirm the booking; the rest is paid in the shop. You can add more services later.
            </p>
          </>
        )}

        {step === 2 && (
          <fieldset className="grid gap-2">
            <legend className="mb-1 text-sm font-medium">When are you open?</legend>
            {WEEK_ORDER.map((d) => (
              <div key={d} className="flex items-center gap-3">
                <label className="flex w-32 items-center gap-2 text-sm">
                  <input type="checkbox" checked={hours[d].enabled} onChange={(e) => setDay(d, { enabled: e.target.checked })} />
                  {DAY_NAMES[d]}
                </label>
                {hours[d].enabled ? (
                  <>
                    <input
                      type="time"
                      aria-label={`${DAY_NAMES[d]} opens`}
                      value={hours[d].start}
                      onChange={(e) => setDay(d, { start: e.target.value })}
                      className="h-9 rounded-md border border-input bg-transparent px-2 text-sm"
                    />
                    <span aria-hidden>–</span>
                    <input
                      type="time"
                      aria-label={`${DAY_NAMES[d]} closes`}
                      value={hours[d].end}
                      onChange={(e) => setDay(d, { end: e.target.value })}
                      className="h-9 rounded-md border border-input bg-transparent px-2 text-sm"
                    />
                  </>
                ) : (
                  <span className="text-sm text-muted-foreground">Closed</span>
                )}
              </div>
            ))}
            {errors?.hours && <p className="text-sm text-red-600 dark:text-red-400">{errors.hours[0]}</p>}
          </fieldset>
        )}

        <div className="mt-2 flex justify-between">
          <Button type="button" variant="ghost" disabled={step === 0} onClick={() => setStep(step - 1)}>
            Back
          </Button>
          {/* Distinct keys matter: sharing one DOM button would flip its type to "submit"
              mid-click and the same click would submit the form from step 2. */}
          {step < 2 ? (
            <Button key="next" type="button" disabled={step === 0 ? !step0Valid : !step1Valid} onClick={() => setStep(step + 1)}>
              Next
            </Button>
          ) : (
            <Button key="submit" type="submit" disabled={pending}>
              {pending ? "Creating your shop…" : "Create my shop"}
            </Button>
          )}
        </div>
      </form>
    </div>
  );
}
