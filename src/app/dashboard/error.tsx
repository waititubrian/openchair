"use client";

import { Button } from "@/components/ui/button";

export default function DashboardError({ retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <div role="alert" className="rounded-lg border border-red-300 p-8 text-center dark:border-red-900">
      <p className="font-medium">Something went wrong loading this page.</p>
      <p className="mt-1 text-sm text-muted-foreground">Your data is safe. Try again, or come back in a moment.</p>
      <Button className="mt-4" onClick={() => retry()}>
        Try again
      </Button>
    </div>
  );
}
