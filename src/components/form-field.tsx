import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Props = React.ComponentProps<typeof Input> & { label: string; errors?: string[] };

/** Label + input + inline error, wired together for accessibility. */
export function FormField({ label, errors, id, name, ...props }: Props) {
  const fieldId = id ?? String(name);
  const errorId = `${fieldId}-error`;
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={fieldId}>{label}</Label>
      <Input
        id={fieldId}
        name={name}
        aria-invalid={errors?.length ? true : undefined}
        aria-describedby={errors?.length ? errorId : undefined}
        {...props}
      />
      {errors?.length ? (
        <p id={errorId} className="text-sm text-red-600 dark:text-red-400">
          {errors[0]}
        </p>
      ) : null}
    </div>
  );
}
