import Link from "next/link";

export default function ShopNotFound() {
  return (
    <div className="py-16 text-center">
      <h1 className="text-xl font-semibold">We couldn&apos;t find that page</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        The shop or service may have moved, or the link may be out of date. Ask the shop for their latest booking link.
      </p>
      <Link href="/" className="mt-4 inline-block text-sm underline underline-offset-4">
        Go to Openchair
      </Link>
    </div>
  );
}
