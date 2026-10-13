import type { Metadata } from "next";
import { Suspense } from "react";
import { GoogleButton } from "@/components/google-button";
import { RedirectIfSignedIn } from "@/components/auth-gate";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { googleEnabled } from "@/lib/auth";
import { safeNextPath } from "@/lib/redirect";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in" };

export default function LoginPage({ searchParams }: PageProps<"/login">) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Sign in</CardTitle>
        <CardDescription>Manage your shop and bookings.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <Suspense fallback={<div className="h-64 animate-pulse rounded-md bg-muted" aria-busy="true" />}>
          <LoginBody searchParams={searchParams} />
        </Suspense>
      </CardContent>
    </Card>
  );
}

async function LoginBody({ searchParams }: Pick<PageProps<"/login">, "searchParams">) {
  const { next } = await searchParams;
  return (
    <RedirectIfSignedIn>
      <LoginForm next={safeNextPath(Array.isArray(next) ? next[0] : next, "")} />
      {googleEnabled && <GoogleButton />}
    </RedirectIfSignedIn>
  );
}
