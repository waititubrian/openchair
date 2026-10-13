import { notFound } from "next/navigation";
import { NotFoundError } from "@/lib/errors";

/** For pages: turn a service's NotFoundError into Next's 404 page. */
export async function orNotFound<T>(promise: Promise<T>): Promise<T> {
  try {
    return await promise;
  } catch (e) {
    if (e instanceof NotFoundError) notFound();
    throw e;
  }
}
