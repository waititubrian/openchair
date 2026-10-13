import type { Metadata } from "next";
import { Suspense } from "react";
import { RedirectIfSignedIn } from "@/components/auth-gate";
import { GoogleButton } from "@/components/google-button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { googleEnabled } from "@/lib/auth";
import { SignupForm } from "./signup-form";

export const metadata: Metadata = { title: "Create your account" };

export default function SignupPage() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Create your account</CardTitle>
        <CardDescription>Free to start. Set up your shop in two minutes.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <Suspense fallback={<div className="h-64 animate-pulse rounded-md bg-muted" aria-busy="true" />}>
          <RedirectIfSignedIn>
            <SignupForm />
            {googleEnabled && <GoogleButton />}
          </RedirectIfSignedIn>
        </Suspense>
      </CardContent>
    </Card>
  );
}
