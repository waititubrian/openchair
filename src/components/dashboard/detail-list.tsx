export function DetailList({ items }: { items: { label: string; value: React.ReactNode }[] }) {
  return (
    <dl className="grid max-w-xl gap-3 rounded-lg border p-4 sm:grid-cols-[10rem_1fr]">
      {items.map((i) => (
        <div key={i.label} className="contents">
          <dt className="text-sm text-muted-foreground">{i.label}</dt>
          <dd className="text-sm">{i.value}</dd>
        </div>
      ))}
    </dl>
  );
}
