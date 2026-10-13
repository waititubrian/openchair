import { toNextJsHandler } from "better-auth/next-js";
import { auth } from "@/lib/auth";

// Better Auth's HTTP API (sign-in, sign-up, Google callback, session, sign-out).
export const { GET, POST } = toNextJsHandler(auth);
