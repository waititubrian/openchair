"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/** Re-checks the page every couple of seconds for up to `seconds` (waiting for M-Pesa's result). */
export function AutoRefresh({ seconds = 30, everyMs = 2500 }: { seconds?: number; everyMs?: number }) {
  const router = useRouter();
  useEffect(() => {
    const tick = setInterval(() => router.refresh(), everyMs);
    const stop = setTimeout(() => clearInterval(tick), seconds * 1000);
    return () => {
      clearInterval(tick);
      clearTimeout(stop);
    };
  }, [router, seconds, everyMs]);
  return null;
}
