"use client";

import { Button } from "@/components/ui/button";

export default function ShopError({ retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <div role="alert" className="py-16 text-center">
      <h1 className="text-xl font-semibold">Something went wrong</h1>
      <p className="mt-2 text-sm text-muted-foreground">We couldn&apos;t load this page. Nothing has been booked. Please try again.</p>
      <Button className="mt-4" onClick={() => retry()}>
        Try again
      </Button>
    </div>
  );
}
