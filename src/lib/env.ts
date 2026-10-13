import "server-only";
import { z } from "zod";

// Validated once, at first import, so a missing variable fails fast with a clear
// message instead of a confusing runtime error deep inside a request.
// Stripe/Resend/Auth keys are optional until the phase that needs them; each of those
// phases will call `requireEnv` for the keys it depends on.
const schema = z.object({
  DATABASE_URL: z.string().min(1),
  DIRECT_URL: z.string().optional(),
  APP_URL: z.string().url().default("http://localhost:3000"),
  AUTH_SECRET: z.string().optional(),
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  STRIPE_CONNECT_WEBHOOK_SECRET: z.string().optional(),
  STRIPE_PRO_PRICE_ID: z.string().optional(),
  RESEND_API_KEY: z.string().optional(),
  EMAIL_FROM: z.string().optional(),
  CRON_SECRET: z.string().optional(),
});

export const env = schema.parse(process.env);

export function requireEnv<K extends keyof typeof env>(key: K): NonNullable<(typeof env)[K]> {
  const v = env[key];
  if (v === undefined || v === "") throw new Error(`Missing required env var ${String(key)}`);
  return v as NonNullable<(typeof env)[K]>;
}
