/**
 * Modo Barra de la app: el personal de barra descarga los QR de consumo (vales) de una noche, lee cada uno una sola
 * vez (el teléfono lo marca y la segunda lectura dice "ya fue leído") y sincroniza. Como cada vale se usa una vez,
 * no hay saldo que se pueda pasar: funciona sin conexión; si dos teléfonos leyeron el mismo, gana el que llegó
 * primero al servidor y el otro recibe ALREADY_REDEEMED con quién y cuándo.
 */
import { prisma } from "../client";
import { BAR_APP_ROLES, type DoorStaff } from "./mobile";
import { nightVouchers, redeemVoucher, type Voucher } from "./nightlife";
import { canSellSession, salesAccess, sellableSessionsWhere } from "./sales-scope";

/** Una noche sigue en la barra hasta 12 h después de empezar (se consume durante la noche). */
const NIGHT_HOURS = 12;

export const canUseBar = (staff: Pick<DoorStaff, "role">) => BAR_APP_ROLES.includes(staff.role);

/** Noches con consumo incluido que esta cuenta puede atender (la barra, solo las que tiene asignadas). */
export async function getBarNights(staff: DoorStaff, now = new Date()) {
  if (!canUseBar(staff)) return [];
  const access = await salesAccess(prisma, staff.id, staff.organizationId, now);
  const sessions = await prisma.eventSession.findMany({
    where: {
      ...sellableSessionsWhere(access),
      cancelledAt: null,
      startsAt: { gt: new Date(now.getTime() - NIGHT_HOURS * 3_600_000), lt: new Date(now.getTime() + 14 * 86_400_000) },
      event: { organizationId: staff.organizationId, status: "PUBLISHED" },
      credits: { some: { amount: { gt: 0 } } },
    },
    orderBy: { startsAt: "asc" },
    include: { event: { select: { title: true } }, venue: { select: { name: true, timezone: true } } },
  });
  const counts = await prisma.consumptionCredit.groupBy({
    by: ["sessionId", "redeemedAt"],
    where: { sessionId: { in: sessions.map((s) => s.id) }, amount: { gt: 0 } },
    _count: true,
  });
  return sessions.map((s) => {
    const mine = counts.filter((c) => c.sessionId === s.id);
    const total = mine.reduce((sum, c) => sum + c._count, 0);
    const read = mine.filter((c) => c.redeemedAt !== null).reduce((sum, c) => sum + c._count, 0);
    return { sessionId: s.id, title: s.event.title, startsAt: s.startsAt.toISOString(), venue: s.venue.name, timezone: s.venue.timezone, vouchers: total, read };
  });
}

/** ¿Puede esta cuenta atender la barra de esa noche? */
async function canServeNight(staff: DoorStaff, sessionId: string, now: Date) {
  if (!canUseBar(staff)) return null;
  const session = await prisma.eventSession.findFirst({
    where: { id: sessionId, cancelledAt: null, event: { organizationId: staff.organizationId, status: { not: "CANCELLED" } } },
    select: { id: true, eventId: true, startsAt: true, venue: { select: { name: true, timezone: true } }, event: { select: { title: true } } },
  });
  if (!session) return null;
  const access = await salesAccess(prisma, staff.id, staff.organizationId, now);
  return canSellSession(access, session) ? session : null;
}

export type BarVoucherJson = {
  code: string;
  label: string;
  people: number;
  buyer: string;
  orderCode: string;
  amount: number;
  currency: string;
  cancelled: boolean;
  /** Ya se leyó (ISO), con quién y la nota. */
  redeemedAt: string | null;
  redeemedBy: string | null;
  note: string | null;
};

const toJson = (v: Voucher): BarVoucherJson => ({
  code: v.code,
  label: v.label,
  people: v.people,
  buyer: v.buyer,
  orderCode: v.orderCode,
  amount: v.amount,
  currency: v.currency,
  cancelled: v.cancelled,
  redeemedAt: v.redeemedAt?.toISOString() ?? null,
  redeemedBy: v.redeemedBy,
  note: v.note,
});

/** Descarga de una noche para el teléfono: todos los vales con su estado. */
export async function getBarDownload(staff: DoorStaff, sessionId: string, now = new Date()) {
  const session = await canServeNight(staff, sessionId, now);
  if (!session) return null;
  const vouchers = await nightVouchers(sessionId);
  return {
    sessionId,
    title: session.event.title,
    venue: session.venue.name,
    timezone: session.venue.timezone,
    syncedAt: now.toISOString(),
    vouchers: vouchers.map(toJson),
  };
}

export type BarReadInput = { id: string; code: string; readAt: string; note?: string };
export type BarReadResult =
  | { id: string; result: "REDEEMED" | "ALREADY_REDEEMED" | "CANCELLED"; voucher: BarVoucherJson }
  | { id: string; result: "REJECTED"; reason: string; code: "NOT_FOUND" | "WRONG_NIGHT" | "NO_CONSUMPTION" };

/**
 * Sube las lecturas del teléfono (en vivo o un lote hecho sin conexión), en el orden en que se leyeron. Cada una trae
 * su id: si el teléfono reenvía la misma, el segundo intento ve el vale ya leído (y por quién), sin duplicar nada.
 */
export async function submitBarReads(staff: DoorStaff, sessionId: string, reads: BarReadInput[], now = new Date()): Promise<BarReadResult[] | null> {
  if (!(await canServeNight(staff, sessionId, now))) return null;
  const ordered = [...reads].toSorted((a, b) => Date.parse(a.readAt) - Date.parse(b.readAt));
  const results: BarReadResult[] = [];
  for (const read of ordered) {
    const out = await redeemVoucher({ raw: read.code, sessionId, staffId: staff.id, note: read.note, readAt: new Date(read.readAt), now });
    results.push(out.status === "REJECTED" ? { id: read.id, result: "REJECTED", reason: out.reason, code: out.code } : { id: read.id, result: out.status, voucher: toJson(out.voucher) });
  }
  return results;
}
