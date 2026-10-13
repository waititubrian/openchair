import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "No access" };

export default function ForbiddenPage() {
  return (
    <section className="mx-auto max-w-md rounded-lg border p-8 text-center">
      <h1 className="text-xl font-semibold">You don&apos;t have access to that page</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Billing, payouts and settings are limited to the shop owner. Ask the owner if you need a change.
      </p>
      <Link href="/dashboard" className="mt-4 inline-block text-sm underline underline-offset-4">
        Back to overview
      </Link>
    </section>
  );
}
