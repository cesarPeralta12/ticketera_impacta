/**
 * Carga los datos de demostración de la arquitectura IMPACTA sobre la base actual, sin
 * borrar nada (a diferencia de la semilla completa). Ver seed-demo.ts.
 */
import path from "node:path";
import { config } from "dotenv";
import { seedArchitectureDemo } from "./seed-demo";

config({ path: path.resolve(import.meta.dirname, "../../../.env"), quiet: true });

async function main() {
  // En un servidor, solo con permiso explícito y contraseña propia (las de prueba están publicadas en el README).
  // No borra nada: solo agrega lo que falta.
  if (process.env.NODE_ENV === "production" && (process.env.SEED_ALLOW !== "si" || !process.env.SEED_PASSWORD)) {
    throw new Error("Datos de demostración en un servidor: solo con SEED_ALLOW=si y SEED_PASSWORD=<tu contraseña> (no borra nada).");
  }
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
