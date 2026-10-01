/**
 * PostgreSQL real para desarrollo local, sin Docker: binarios oficiales empaquetados en npm.
 * Los datos quedan en packages/db/.pgdata (no se versiona).
 *
 *   npm run db:local     -> levanta Postgres en el puerto 5433 (Ctrl+C para detenerlo)
 *
 * La URL coincide con la de docker-compose.yml, así que se puede usar cualquiera de los dos.
 */
import { existsSync } from "node:fs";
import path from "node:path";
import EmbeddedPostgres from "embedded-postgres";
import pg from "pg";

const PORT = 5433;
const USER = "ticketera";
const PASSWORD = "ticketera";
const DATABASE = "ticketera";
const dataDir = path.resolve(import.meta.dirname, "../.pgdata");

const server = new EmbeddedPostgres({
  databaseDir: dataDir,
  user: USER,
  password: PASSWORD,
  port: PORT,
  persistent: true,
  onLog: () => {},
  onError: (error) => console.error(String(error)),
});

if (!existsSync(path.join(dataDir, "PG_VERSION"))) {
  console.log("Inicializando PostgreSQL por primera vez...");
  await server.initialise();
}
await server.start();

const admin = new pg.Client({
  connectionString: `postgresql://${USER}:${PASSWORD}@localhost:${PORT}/postgres`,
});
await admin.connect();
const { rowCount } = await admin.query("SELECT 1 FROM pg_database WHERE datname = $1", [DATABASE]);
if (!rowCount) await admin.query(`CREATE DATABASE ${DATABASE}`);
await admin.end();

console.log(`PostgreSQL listo: postgresql://${USER}:${PASSWORD}@localhost:${PORT}/${DATABASE}`);
console.log("Ctrl+C para detenerlo.");

let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  await server.stop();
  process.exit(0);
}
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
