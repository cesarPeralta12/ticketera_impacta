import path from "node:path";
import { config } from "dotenv";
import { defineConfig } from "prisma/config";

// Un solo .env para todo el monorepo, en la raíz.
config({ path: path.resolve(import.meta.dirname, "../../.env"), quiet: true });

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    // `prisma generate` no necesita conexión; migrate/seed/studio sí.
    url: process.env.DATABASE_URL ?? "",
  },
});
