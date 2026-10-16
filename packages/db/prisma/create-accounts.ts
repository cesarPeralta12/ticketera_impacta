/**
 * Crea de una vez cuentas de clientes para usar el sistema: organizadores de eventos y boliches, cada uno con su
 * panel propio de solo lectura (Impacta entra con "Entrar" y les arma recintos, eventos o noches). Es lo mismo que
 * "Nuevo usuario de eventos / de boliche" en Organizadores. No borra nada: una cuenta cuyo email ya existe se salta.
 *
 * Por defecto, 3 de eventos (eventos1@impacta.test …) y 3 de boliche (boliche1@impacta.test …):
 *   ACCOUNTS_PASSWORD='una-temporal' npm run db:accounts -w @ticketera/db
 *
 * Con nombres y emails propios (tipo:nombre:email, separados por ";"; tipo = eventos o boliche):
 *   ACCOUNTS='eventos:Producciones Sur:sur@correo.com;boliche:Club Norte:norte@correo.com' ACCOUNTS_PASSWORD='…' npm run db:accounts -w @ticketera/db
 *
 * La contraseña es temporal (no queda en el repositorio): cada cuenta la cambia al entrar por primera vez.
 */
import path from "node:path";
import { config } from "dotenv";
import { MIN_PASSWORD_LENGTH } from "@ticketera/core";

config({ path: path.resolve(import.meta.dirname, "../../../.env"), quiet: true });

type Account = { kind: "EVENTS" | "NIGHTLIFE"; name: string; email: string };

const DEFAULTS: Account[] = [
  ...[1, 2, 3].map((n) => ({ kind: "EVENTS" as const, name: `Cliente Eventos ${n}`, email: `eventos${n}@impacta.test` })),
  ...[1, 2, 3].map((n) => ({ kind: "NIGHTLIFE" as const, name: `Cliente Boliche ${n}`, email: `boliche${n}@impacta.test` })),
];

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function parseAccounts(value: string | undefined): Account[] {
  if (!value?.trim()) return DEFAULTS;
  return value
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const pieces = part.split(":").map((p) => p.trim());
      const kind = pieces[0]?.toLowerCase();
      const email = pieces.at(-1)?.toLowerCase() ?? "";
      const name = pieces.slice(1, -1).join(":");
      if ((kind !== "eventos" && kind !== "boliche") || !name || !EMAIL.test(email)) {
        throw new Error(`Cuenta mal escrita: "${part}". Formato: eventos:Nombre:email o boliche:Nombre:email`);
      }
      return { kind: kind === "boliche" ? "NIGHTLIFE" : "EVENTS", name, email };
    });
}

async function main() {
  const password = process.env.ACCOUNTS_PASSWORD ?? "";
  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new Error(`Falta ACCOUNTS_PASSWORD (contraseña temporal de al menos ${MIN_PASSWORD_LENGTH} caracteres).`);
  }
  const accounts = parseAccounts(process.env.ACCOUNTS);

  const { prisma, createOrganizer } = await import("../src/index");
  // Queda registrado como hecho por el dueño de Impacta (en Seguridad).
  const owner = await prisma.membership.findFirst({
    where: { organization: { isPlatform: true }, role: "OWNER" },
    orderBy: { createdAt: "asc" },
    select: { userId: true },
  });

  for (const account of accounts) {
    const label = account.kind === "NIGHTLIFE" ? "boliche" : "eventos";
    if (await prisma.staffUser.findUnique({ where: { email: account.email } })) {
      console.log(`· ${account.email} (${label}): ya existía, no se cambió.`);
      continue;
    }
    await createOrganizer({
      name: account.name,
      kind: account.kind,
      contactEmail: account.email,
      admin: { name: account.name, email: account.email, password },
      actorId: owner?.userId ?? "script",
    });
    console.log(`✓ ${account.email} (${label}): "${account.name}" creado, solo lectura.`);
  }
  console.log("Entran en el panel con su email y la contraseña temporal; al entrar eligen una propia.");
  await prisma.$disconnect();
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
