import path from "node:path";
import { config } from "dotenv";

/**
 * Las pruebas de integración corren en una base aparte ("<base>_test"), que se borra y
 * se vuelve a crear en cada corrida. Nunca tocan la base de desarrollo.
 */
export function testDatabaseUrls() {
  config({ path: path.resolve(import.meta.dirname, "../../../.env"), quiet: true });
  if (!process.env.DATABASE_URL) throw new Error("Falta DATABASE_URL para las pruebas de integración.");
  const base = new URL(process.env.DATABASE_URL);
  const name = base.pathname.slice(1) || "ticketera";
  const test = new URL(base);
  test.pathname = `/${name}_test`;
  const admin = new URL(base);
  admin.pathname = "/postgres";
  return { name: `${name}_test`, test: test.toString(), admin: admin.toString() };
}
