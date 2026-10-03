import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { formatDateTime } from "@ticketera/core";
import { upcomingDoorSessions } from "@/lib/door";
import { ROLES, requireStaff } from "@/lib/session";

export const metadata: Metadata = { title: { absolute: "Funciones · Puerta Impacta" } };

export default async function DoorHomePage() {
  await connection();
  const staff = await requireStaff(ROLES.access);
  const sessions = await upcomingDoorSessions(staff);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">¿Qué función controlas?</h1>
        <p className="text-sm text-white/60">
          Al entrar, el equipo descarga la lista de entradas: si después se corta internet, sigue validando y sube las
          lecturas cuando vuelve la conexión.
        </p>
      </div>
      {sessions.length === 0 ? (
        <p className="rounded-xl bg-white/5 p-5 text-white/70">No hay funciones próximas.</p>
      ) : (
        <ul className="space-y-2">
          {sessions.map((s) => (
            <li key={s.id}>
              <Link href={`/puerta/${s.id}`} className="block rounded-xl bg-white/5 p-4 active:bg-white/10">
                <p className="text-lg font-semibold">{s.event.title}</p>
                <p className="text-sm text-white/70">
                  {formatDateTime(s.startsAt, s.venue.timezone)} · {s.venue.name}
                </p>
                <p className="mt-1 text-xs text-white/50">
                  {s._count.tickets} {s.event.mode === "GUEST_LIST" ? "invitados" : "entradas emitidas"}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
