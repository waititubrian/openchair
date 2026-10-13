import "server-only";
import { headers } from "next/headers";
import { APIError } from "better-auth/api";
import { auth } from "@/lib/auth";
import { ConflictError, UnauthorizedError } from "@/lib/errors";
import type { SignInInput, SignUpInput } from "@/validators/auth";

// Wraps Better Auth so the rest of the app depends on our errors, not the library's.
// Cookies are set by the nextCookies() plugin because these run inside server actions.

export async function signUp(input: SignUpInput): Promise<void> {
  try {
    await auth.api.signUpEmail({ body: input });
  } catch (e) {
    if (e instanceof APIError) {
      const code = String((e.body as { code?: string } | undefined)?.code ?? "");
      if (code.includes("USER_ALREADY_EXISTS")) {
        throw new ConflictError("An account with that email already exists", "EMAIL_TAKEN");
      }
    }
    throw e;
  }
}

export async function signIn(input: SignInInput): Promise<void> {
  try {
    await auth.api.signInEmail({ body: input });
  } catch (e) {
    // Same message for unknown email and wrong password: don't reveal which accounts exist.
    if (e instanceof APIError && e.statusCode >= 400 && e.statusCode < 500) {
      throw new UnauthorizedError("Incorrect email or password");
    }
    throw e;
  }
}

export async function signOut(): Promise<void> {
  await auth.api.signOut({ headers: await headers() });
}
