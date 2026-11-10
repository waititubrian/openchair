import "server-only";
import { z } from "zod";

// Validated once, at first import, so a missing variable fails fast with a clear
// message instead of a confusing runtime error deep inside a request.
// Empty strings (as in .env.example) are treated as "not set".
// Resend keys are optional until the phase that needs them; each of those
// phases will call `requireEnv` for the keys it depends on.
const optional = z.preprocess((v) => (v === "" ? undefined : v), z.string().optional());

const schema = z.object({
  DATABASE_URL: z.string().min(1),
  DIRECT_URL: optional,
  APP_URL: z.string().url().default("http://localhost:3000"),
  AUTH_SECRET: z.preprocess((v) => (v === "" ? undefined : v), z.string().min(32).optional()),
  GOOGLE_CLIENT_ID: optional,
  GOOGLE_CLIENT_SECRET: optional,
  // M-Pesa (Safaricom Daraja). SANDBOX ONLY: "production" is refused when the gateway is created.
  MPESA_MODE: z.preprocess((v) => (v === "" ? undefined : v), z.enum(["daraja", "simulator"]).optional()),
  MPESA_ENV: z.preprocess((v) => (v === "" ? undefined : v), z.enum(["sandbox", "production"]).default("sandbox")),
  MPESA_CONSUMER_KEY: optional,
  MPESA_CONSUMER_SECRET: optional,
  MPESA_SHORTCODE: optional,
  MPESA_PASSKEY: optional,
  /** Public HTTPS origin Safaricom can reach (a tunnel locally). Defaults to APP_URL. */
  MPESA_CALLBACK_BASE_URL: optional,
  /** Unguessable path segment of the callback URL (callbacks are not signed). 16+ characters. */
  MPESA_CALLBACK_SECRET: z.preprocess((v) => (v === "" ? undefined : v), z.string().min(16).optional()),
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
