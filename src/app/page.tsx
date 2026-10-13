import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";

// Placeholder landing. The full marketing page with pricing is built in a later phase.
export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col items-center justify-center gap-6 px-4 py-24 text-center">
      <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">Bookings and deposits for barbershops and salons</h1>
      <p className="max-w-xl text-muted-foreground">
        Give customers a link to book their slot and pay a deposit. No accounts, no no-shows.
      </p>
      <div className="flex gap-3">
        <Link href="/signup" className={buttonVariants()}>
          Get started free
        </Link>
        <Link href="/login" className={buttonVariants({ variant: "outline" })}>
          Sign in
        </Link>
      </div>
    </main>
  );
}
