import { execFileSync } from "node:child_process";
import "dotenv/config";
import pg from "pg";

// Integration tests run against their OWN database (<name>_test) in the same Postgres server, never
// your development database. Some behaviour is GLOBAL by nature (the cron sweep cancels expired holds and
// downgrades lapsed subscriptions for every shop), so testing it against real data would be destructive.
// This runs once before the suite: it creates the database if needed and applies all migrations.

export function testDatabaseUrl(): string {
  const base = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
  if (!base) throw new Error("DATABASE_URL is not set");
  const url = new URL(base);
  const name = url.pathname.replace(/^\//, "");
  if (!name.endsWith("_test")) url.pathname = `/${name}_test`;
  return url.toString();
}

export default async function setup() {
  const testUrl = testDatabaseUrl();
  const dbName = new URL(testUrl).pathname.slice(1);

  // Connect to the server's maintenance database to create the test database if it is missing.
  const admin = new URL(testUrl);
  admin.pathname = "/postgres";
  const client = new pg.Client({ connectionString: admin.toString() });
  await client.connect();
  try {
    const exists = await client.query("select 1 from pg_database where datname = $1", [dbName]);
    if (exists.rowCount === 0) await client.query(`create database "${dbName.replace(/"/g, "")}"`);
  } finally {
    await client.end();
  }

  execFileSync("npx", ["prisma", "migrate", "deploy"], {
    env: { ...process.env, DATABASE_URL: testUrl, DIRECT_URL: testUrl },
    stdio: "pipe",
  });
}
