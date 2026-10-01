"use server";

import { prisma, scanTicket, type ScanOutcome } from "@ticketera/db";
import { ROLES, requireStaff } from "@/lib/session";

export type ScanState =
  | (Omit<ScanOutcome, "previousEntry"> & {
      previousEntry: { at: string; accessPoint: string | null } | null;
      scannedAt: string;
    })
  | null;

export async function scanAction(_prev: ScanState, formData: FormData): Promise<ScanState> {
  const staff = await requireStaff(ROLES.access);
  const raw = String(formData.get("raw") ?? "");
  if (!raw.trim()) return null;

  // La función y la puerta deben ser de la organización del operador.
  const session = await prisma.eventSession.findFirst({
    where: { id: String(formData.get("sessionId")), event: { organizationId: staff.organization.id } },
    select: { id: true, venueId: true },
  });
  if (!session) return null;
  const accessPoint = await prisma.accessPoint.findFirst({
    where: { id: String(formData.get("accessPointId") ?? ""), venueId: session.venueId },
    select: { id: true },
  });

  const outcome = await scanTicket({
    sessionId: session.id,
    accessPointId: accessPoint?.id,
    operatorId: staff.id,
    raw,
  });
  return {
    ...outcome,
    previousEntry: outcome.previousEntry
      ? { at: outcome.previousEntry.at.toISOString(), accessPoint: outcome.previousEntry.accessPoint }
      : null,
    scannedAt: new Date().toISOString(),
  };
}
