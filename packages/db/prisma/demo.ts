/**
 * Carga los datos de demostración de la arquitectura IMPACTA sobre la base actual, sin
 * borrar nada (a diferencia de la semilla completa). Ver seed-demo.ts.
 */
import path from "node:path";
import { config } from "dotenv";
import { seedArchitectureDemo } from "./seed-demo";

config({ path: path.resolve(import.meta.dirname, "../../../.env"), quiet: true });

async function main() {
  if (process.env.NODE_ENV === "production") throw new Error("Datos de demostración: no se cargan en producción.");
  const db = await import("../src/index");
  const org = await db.prisma.organization.findUnique({ where: { slug: "impacta" } });
  if (!org) throw new Error('No existe la organización "impacta": corre primero la semilla (npm run db:seed).');
  const log = await seedArchitectureDemo(db, org.id);
  console.log(log.length ? `Agregado:\n- ${log.join("\n- ")}` : "Ya estaba todo cargado.");
  await db.prisma.$disconnect();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
