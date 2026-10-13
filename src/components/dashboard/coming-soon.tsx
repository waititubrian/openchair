export function ComingSoon({ title, description }: { title: string; description: string }) {
  return (
    <section>
      <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
      <div className="mt-6 rounded-lg border border-dashed p-10 text-center">
        <p className="font-medium">Nothing here yet</p>
        <p className="mt-1 text-sm text-muted-foreground">{description}</p>
      </div>
    </section>
  );
}
