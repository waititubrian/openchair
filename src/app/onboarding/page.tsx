import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { getTenantContext, requireUser } from "@/services/session.service";
import { OnboardingWizard } from "./wizard";

export const metadata: Metadata = { title: "Set up your shop" };

export default function OnboardingPage() {
  return (
    <main className="mx-auto w-full max-w-xl px-4 py-10">
      <Suspense fallback={<div className="h-96 animate-pulse rounded-lg bg-muted" aria-busy="true" />}>
        <OnboardingGate />
      </Suspense>
    </main>
  );
}

async function OnboardingGate() {
  const user = await requireUser();
  if (await getTenantContext()) redirect("/dashboard"); // already set up
  return <OnboardingWizard firstName={user.name.split(" ")[0]} />;
}
