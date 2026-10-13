import { createAuthClient } from "better-auth/react";

// Browser-side client. Used only for Google sign-in (redirect flow); email/password
// goes through server actions so input is validated with our Zod schemas first.
export const authClient = createAuthClient();
