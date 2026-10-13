import { NextResponse, type NextRequest } from "next/server";
import { getSessionCookie } from "better-auth/cookies";

// OPTIMISTIC check only: a cookie exists or it doesn't. It saves signed-out visitors a
// round trip. It does NOT prove the session is valid; every protected page/action
// re-verifies through services/session.service.ts (see Next.js "Authentication" guide).
export function proxy(request: NextRequest) {
  if (!getSessionCookie(request)) {
    const login = new URL("/login", request.url);
    login.searchParams.set("next", request.nextUrl.pathname + request.nextUrl.search);
    return NextResponse.redirect(login);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/dashboard/:path*", "/onboarding", "/admin/:path*"],
};
