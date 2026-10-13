import { Button } from "@/components/ui/button";
import { signOutAction } from "@/app/(auth)/actions";

export function SignOutButton() {
  return (
    <form action={signOutAction}>
      <Button type="submit" variant="outline" size="sm">
        Sign out
      </Button>
    </form>
  );
}
