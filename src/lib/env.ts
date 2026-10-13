import "server-only";
import { z } from "zod";

// Validated once, at first import, so a missing variable fails fast with a clear
// message instead of a confusing runtime error deep inside a request.
// Empty strings (as in .env.example) are treated as "not set".
// Stripe/Resend keys are optional until the phase that needs them; each of those
// phases will call `requireEnv` for the keys it depends on.
const optional = z.preprocess((v) => (v === "" ? undefined : v), z.string().optional());

const schema = z.object({
  DATABASE_URL: z.string().min(1),
  DIRECT_URL: optional,
  APP_URL: z.string().url().default("http://localhost:3000"),
  AUTH_SECRET: z.preprocess((v) => (v === "" ? undefined : v), z.string().min(32).optional()),
  GOOGLE_CLIENT_ID: optional,
  GOOGLE_CLIENT_SECRET: optional,
  STRIPE_SECRET_KEY: optional,
  STRIPE_WEBHOOK_SECRET: optional,
  STRIPE_CONNECT_WEBHOOK_SECRET: optional,
  STRIPE_PRO_PRICE_ID: optional,
  RESEND_API_KEY: optional,
  EMAIL_FROM: optional,
  CRON_SECRET: optional,
});

export const env = schema.parse(process.env);

export function requireEnv<K extends keyof typeof env>(key: K): NonNullable<(typeof env)[K]> {
  const v = env[key];
  if (v === undefined || v === "") throw new Error(`Missing required env var ${String(key)}`);
  return v as NonNullable<(typeof env)[K]>;
}
