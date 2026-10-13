export function DashboardSkeleton() {
  return (
    <div className="flex flex-1 flex-col gap-4 p-6 md:flex-row" aria-busy="true" aria-label="Loading dashboard">
      <div className="h-10 w-full animate-pulse rounded-md bg-muted md:h-64 md:w-52" />
      <div className="flex-1 space-y-4">
        <div className="h-8 w-48 animate-pulse rounded-md bg-muted" />
        <div className="h-40 animate-pulse rounded-md bg-muted" />
      </div>
    </div>
  );
}
