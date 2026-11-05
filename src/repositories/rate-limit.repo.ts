import "server-only";
import { dbOrTx, type Tx } from "./transaction";

/**
 * Fixed-window counter in the RateLimit table (the table Better Auth also uses; our keys are
 * namespaced "pub:" so they never collide). One atomic upsert per call, so concurrent requests
 * (and separate serverless instances) all increment the same row.
 * `lastRequest` holds the window START here.
 */
export async function consume(key: string, windowSeconds: number, now: Date, tx?: Tx): Promise<number> {
  const nowMs = now.getTime();
  const windowStartCutoff = nowMs - windowSeconds * 1000;
  const rows = await dbOrTx(tx).$queryRaw<{ count: number }[]>`
    INSERT INTO "RateLimit" ("id", "key", "count", "lastRequest")
    VALUES (gen_random_uuid()::text, ${key}, 1, ${nowMs}::bigint)
    ON CONFLICT ("key") DO UPDATE SET
      "count" = CASE WHEN "RateLimit"."lastRequest" < ${windowStartCutoff}::bigint THEN 1 ELSE "RateLimit"."count" + 1 END,
      "lastRequest" = CASE WHEN "RateLimit"."lastRequest" < ${windowStartCutoff}::bigint THEN ${nowMs}::bigint ELSE "RateLimit"."lastRequest" END
    RETURNING "count"
  `;
  return Number(rows[0].count);
}
