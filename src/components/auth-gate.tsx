import { redirect } from "next/navigation";
import { getSessionUser } from "@/services/session.service";

/** On /login and /signup: signed-in visitors skip straight to the dashboard (real session check). */
export async function RedirectIfSignedIn({ children }: { children: React.ReactNode }) {
  if (await getSessionUser()) redirect("/dashboard");
  return children;
}
