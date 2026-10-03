import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { formatDateTime } from "@ticketera/core";
import { doorSession } from "@/lib/door";
import { ROLES, requireStaff } from "@/lib/session";
import { DoorApp } from "./door-app";

export const metadata: Metadata = { title: "Control de acceso" };

type Props = { params: Promise<{ sessionId: string }> };

export default async function DoorSessionPage({ params }: Props) {
  await connection();
  const staff = await requireStaff(ROLES.access);
  const session = await doorSession(staff, (await params).sessionId);
  if (!session) notFound();

  return (
    <div className="space-y-4">
      <div>
        <Link href="/puerta" className="text-sm text-white/50">
          ← Funciones
        </Link>
        <h1 className="text-xl font-bold leading-tight">{session.event.title}</h1>
        <p className="text-sm text-white/60">
          {formatDateTime(session.startsAt, session.venue.timezone)} · {session.venue.name}
        </p>
      </div>
      <DoorApp sessionId={session.id} timezone={session.venue.timezone} />
    </div>
  );
}
