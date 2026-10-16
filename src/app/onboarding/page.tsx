import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { SignOutButton } from "@/components/dashboard/sign-out-button";
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
  return (
    <>
      <div className="mb-6 flex items-center justify-between gap-4 text-sm text-muted-foreground">
        <span className="truncate">Signed in as {user.email}</span>
        <SignOutButton />
      </div>
      <OnboardingWizard firstName={user.name.split(" ")[0]} />
    </>
  );
}
