"use client";

import { Button } from "@/components/ui/button";
import { authClient } from "@/lib/auth-client";

export function GoogleButton() {
  return (
    <Button
      type="button"
      variant="outline"
      className="w-full"
      onClick={() => authClient.signIn.social({ provider: "google", callbackURL: "/dashboard" })}
    >
      Continue with Google
    </Button>
  );
}
