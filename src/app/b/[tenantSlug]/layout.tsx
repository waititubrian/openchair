import Link from "next/link";

// Public, no login. Kept deliberately plain and mobile-first: customers open these links on a phone.
export default function PublicShopLayout({ children }: LayoutProps<"/b/[tenantSlug]">) {
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col px-4 py-8">
      <div className="flex-1">{children}</div>
      <footer className="mt-10 border-t pt-4 text-center text-xs text-muted-foreground">
        Bookings by{" "}
        <Link href="/" className="underline underline-offset-4">
          Openchair
        </Link>
      </footer>
    </div>
  );
}
