import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

// Layering rules (see README "Architecture"):
//   app, components  ->  services  ->  repositories  ->  lib/prisma
// Only repositories touch the database client. Pages/handlers never see a repository.
const PRISMA = {
  group: ["@prisma/*", "**/generated/prisma", "**/generated/prisma/**"],
  message:
    "Prisma may only be imported in src/repositories (and src/lib/domain|prisma). Use a repository, or import enums/types from @/lib/domain.",
};
const RAW_CLIENT = {
  group: ["@/lib/prisma", "**/lib/prisma", "./prisma"],
  message: "The raw database client may only be imported by src/repositories.",
};
const REPOSITORIES = {
  group: ["@/repositories", "@/repositories/**", "**/repositories", "**/repositories/**"],
  message: "Call a service instead; repositories are only used by src/services.",
};
const SERVICES = {
  group: ["@/services", "@/services/**", "**/services", "**/services/**"],
  message: "src/lib is the bottom layer and must not depend on services.",
};

const restrict = (...patterns) => ({
  "no-restricted-imports": ["error", { patterns }],
});

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Default for everything: no Prisma, no raw client.
  { files: ["src/**/*.{ts,tsx}", "tests/**/*.ts"], rules: restrict(PRISMA, RAW_CLIENT) },
  // Repositories are the one place allowed to use Prisma and the raw client.
  { files: ["src/repositories/**/*.ts"], rules: { "no-restricted-imports": "off" } },
  // lib: may use Prisma packages (client init, domain re-exports) but is the bottom layer.
  { files: ["src/lib/**/*.{ts,tsx}"], rules: restrict(RAW_CLIENT, REPOSITORIES, SERVICES) },
  // Better Auth owns the User/Session/Account/Verification tables, so its config module
  // is the single non-repository file that hands the raw client to a library.
  { files: ["src/lib/auth.ts"], rules: restrict(REPOSITORIES, SERVICES) },
  // Thin layer: pages, route handlers, server actions, components never see repositories.
  {
    files: ["src/app/**/*.{ts,tsx}", "src/components/**/*.{ts,tsx}"],
    rules: restrict(PRISMA, RAW_CLIENT, REPOSITORIES),
  },
  // Validators are pure Zod.
  {
    files: ["src/validators/**/*.ts"],
    rules: restrict(PRISMA, RAW_CLIENT, REPOSITORIES, SERVICES),
  },
  // The seed script and tests build their own client (they run outside Next).
  { files: ["prisma/**/*.ts", "tests/**/*.ts"], rules: { "no-restricted-imports": "off" } },
  globalIgnores([".next/**", "out/**", "build/**", "next-env.d.ts", "src/generated/**"]),
]);

export default eslintConfig;
