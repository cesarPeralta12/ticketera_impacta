/**
 * Primer arranque de un servidor real (Coolify): crea Impacta y su primer dueño. No borra nada.
 *
 *   BOOTSTRAP_EMAIL=dueno@tudominio.bo BOOTSTRAP_NAME="Tu Nombre" npm run db:bootstrap
 *
 * Opcional: BOOTSTRAP_PASSWORD (si no, se genera una y se muestra una sola vez; hay que cambiarla al entrar).
 */
import "dotenv/config";
import { bootstrapPlatform } from "../src/operations/bootstrap";
import { prisma } from "../src/client";

const email = process.env.BOOTSTRAP_EMAIL;
const name = process.env.BOOTSTRAP_NAME;
if (!email || !name) {
  console.error('Faltan BOOTSTRAP_EMAIL y BOOTSTRAP_NAME. Ejemplo: BOOTSTRAP_EMAIL=dueno@tudominio.bo BOOTSTRAP_NAME="Tu Nombre" npm run db:bootstrap');
  process.exit(1);
}

const result = await bootstrapPlatform({ email, name, password: process.env.BOOTSTRAP_PASSWORD || undefined });
if (!result.created) {
  console.log("Ya existe la plataforma con su dueño: no se hizo ningún cambio.");
} else {
  console.log(`Listo. Entra al panel con ${result.email} y esta contraseña temporal (cámbiala al entrar):\n\n  ${result.temporaryPassword}\n`);
}
await prisma.$disconnect();
