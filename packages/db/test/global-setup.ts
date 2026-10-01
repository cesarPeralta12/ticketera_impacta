import { execSync } from "node:child_process";
import path from "node:path";
import pg from "pg";
import { testDatabaseUrls } from "./test-db";

export default async function setup() {
  const urls = testDatabaseUrls();
  const admin = new pg.Client({ connectionString: urls.admin });
  await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS "${urls.name}" WITH (FORCE)`);
  await admin.query(`CREATE DATABASE "${urls.name}"`);
  await admin.end();

  execSync("npx prisma migrate deploy", {
    cwd: path.resolve(import.meta.dirname, ".."),
    env: { ...process.env, DATABASE_URL: urls.test },
    stdio: "ignore",
  });
}
