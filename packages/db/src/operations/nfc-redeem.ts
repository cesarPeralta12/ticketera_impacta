/**
 * Canje de una entrada por una tarjeta o manilla NFC: quién puede hacerlo, en qué funciones y qué entrada corresponde a
 * lo que se leyó. La vinculación en sí está en nfc-cards.ts (la usan el panel y la app de canje).
 */
import {
  deriveTicketKey,
  parseDynamicPayload,
  parseManualWithOtp,
  parseTicketPayload,
  printedOpensDoor,
  tableLabel,
  type PrintStateName,
  verifyDynamicOtp,
  verifyDynamicPayload,
} from "@ticketera/core";
import { prisma } from "../client";
import { findExternalTicket } from "./access";
import type { DoorStaff } from "./mobile";
import { expireTimedTickets } from "./nightlife";
import { canSellSession, salesAccess, sellableSessionsWhere } from "./sales-scope";
import { requireEnv } from "./shared";

export type RedeemStaff = Pick<DoorStaff, "id" | "role" | "organizationId">;

/**
 * ¿La cuenta puede canjear entradas por tarjeta? El dueño y los administradores, siempre; un cajero o un portero, solo
 * si lo habilitaron en Usuarios. Nadie más.
 */
export async function canRedeemNfc(staff: RedeemStaff) {
  if (staff.role === "OWNER" || staff.role === "ADMIN") return true;
  if (staff.role !== "CASHIER" && staff.role !== "OPERATOR") return false;
  const membership = await prisma.membership.findFirst({
    where: { userId: staff.id, organizationId: staff.organizationId, role: staff.role, user: { active: true } },
    select: { canRedeemNfc: true },
  });
  return membership?.canRedeemNfc ?? false;
}

/** ¿Puede canjear en esta función? Además del permiso: que sea de su organización, siga en pie y la tenga permitida. */
export async function canRedeemSession(staff: RedeemStaff, sessionId: string) {
  if (!(await canRedeemNfc(staff))) return false;
  const session = await prisma.eventSession.findFirst({
    where: { id: sessionId, cancelledAt: null, event: { organizationId: staff.organizationId, status: { not: "CANCELLED" } } },
    select: { id: true, eventId: true },
  });
  if (!session) return false;
  // Un portero, solo en las funciones que tiene asignadas para la puerta.
  if (staff.role === "OPERATOR") return (await prisma.doorAssignment.count({ where: { userId: staff.id, sessionId } })) > 0;
  if (staff.role !== "CASHIER") return true;
  return canSellSession(await salesAccess(prisma, staff.id, staff.organizationId), session);
}

/**
 * Funciones en las que la cuenta puede canjear: las recientes y próximas (publicadas o no) que tienen algún tipo de
 * entrada con NFC. Un cajero con «solo lo asignado» y un portero ven solo las suyas.
 */
export async function redeemSessions(staff: RedeemStaff, now = new Date()) {
  if (!(await canRedeemNfc(staff))) return [];
  const scope =
    staff.role === "CASHIER"
      ? sellableSessionsWhere(await salesAccess(prisma, staff.id, staff.organizationId, now))
      : staff.role === "OPERATOR"
        ? { doorAssignments: { some: { userId: staff.id } } }
        : {};
  return prisma.eventSession.findMany({
    where: {
      ...scope,
      cancelledAt: null,
      startsAt: { gt: new Date(now.getTime() - 48 * 60 * 60_000) },
      event: { organizationId: staff.organizationId, status: { not: "CANCELLED" } },
      ticketTypes: { some: { accessMethods: { has: "NFC" } } },
    },
    orderBy: { startsAt: "asc" },
    take: 50,
    include: { event: { select: { title: true, status: true } }, venue: { select: { name: true, timezone: true } } },
  });
}

export type RedeemTicket = {
  code: string;
  holder: string | null;
  document: string | null;
  type: string;
  seat: string | null;
  /** Número de serie de la tarjeta que ya tiene (cambiarla es una reposición). */
  currentUid: string | null;
  /** Se puede vincular, pero hay algo que avisar (ej. impresa sin vender). */
  notice: string | null;
};

export type RedeemLookup =
  | { ok: true; ticket: RedeemTicket }
  | { ok: false; reason: "FORBIDDEN" | "NOT_FOUND" | "WRONG_SESSION" | "CANCELLED" | "USED" | "NFC_NOT_ENABLED" | "QR_NOT_VALID" };

/**
 * La entrada que corresponde a lo leído en el mostrador: el QR o código de barras de iPass, el código escrito o el de un
 * tercero importado. Una entrada de QR dinámico exige su QR vigente (o el código con su clave de un momento), igual que
 * en la puerta: así una captura de pantalla vieja no sirve para quedarse con la tarjeta.
 */
export async function findTicketForRedeem(staff: RedeemStaff, sessionId: string, raw: string, now = new Date()): Promise<RedeemLookup> {
  if (!(await canRedeemSession(staff, sessionId))) return { ok: false, reason: "FORBIDDEN" };
  await expireTimedTickets(sessionId);
  const secret = requireEnv("TICKET_QR_SECRET");
  const input = raw.trim();
  const dynamic = input.startsWith("TK2.") ? parseDynamicPayload(input) : null;
  const otp = dynamic ? null : parseManualWithOtp(input);
  const statik = dynamic || otp ? null : await parseTicketPayload(input, secret);
  const code = dynamic?.code ?? otp?.code ?? (statik?.ok ? statik.code : null);

  const external = async () => (dynamic ? null : ((await findExternalTicket(sessionId, input))?.id ?? null));
  const include = {
    ticketType: { select: { name: true, accessMethods: true, qrMode: true } },
    seat: { select: { label: true } },
    order: { select: { buyerName: true, buyerDocument: true } },
    credit: { select: { tableNumber: true, seat: { select: { label: true } } } },
    printBatch: { select: { mode: true } },
  } as const;
  let ticket = code ? await prisma.ticket.findUnique({ where: { code }, include }) : null;
  if (!ticket) {
    const id = await external();
    ticket = id ? await prisma.ticket.findUnique({ where: { id }, include }) : null;
  }
  if (!ticket) return { ok: false, reason: "NOT_FOUND" };

  // Una entrada de otra organización no existe para esta cuenta; una de otra función de las suyas, se dice.
  if (ticket.sessionId !== sessionId) {
    const own = await prisma.eventSession.count({ where: { id: ticket.sessionId, event: { organizationId: staff.organizationId } } });
    return { ok: false, reason: own > 0 ? "WRONG_SESSION" : "NOT_FOUND" };
  }

  if (ticket.ticketType.qrMode === "DYNAMIC") {
    const key = await deriveTicketKey(secret, ticket.code);
    const valid = dynamic
      ? (await verifyDynamicPayload(key, dynamic, now.getTime())) === "OK"
      : otp
        ? await verifyDynamicOtp(key, ticket.code, otp.otp, now.getTime())
        : false;
    if (!valid) return { ok: false, reason: "QR_NOT_VALID" };
  } else if (dynamic) {
    return { ok: false, reason: "QR_NOT_VALID" };
  }

  if (ticket.status === "CANCELLED" || ticket.printState === "VOID") return { ok: false, reason: "CANCELLED" };
  if (ticket.status === "USED") return { ok: false, reason: "USED" };
  if (!ticket.ticketType.accessMethods.includes("NFC")) return { ok: false, reason: "NFC_NOT_ENABLED" };

  const unsold = ticket.printBatch !== null && !printedOpensDoor(ticket.printBatch.mode, (ticket.printState ?? "STOCK") as PrintStateName);
  return {
    ok: true,
    ticket: {
      code: ticket.code,
      holder: ticket.holderName ?? ticket.order.buyerName,
      document: ticket.holderDocument ?? ticket.order.buyerDocument,
      type: ticket.ticketType.name,
      seat: tableLabel(ticket.ticketType.name, ticket.credit?.tableNumber, ticket.credit?.seat?.label) ?? ticket.seat?.label ?? null,
      currentUid: ticket.nfcUid,
      notice: unsold ? "Entrada impresa sin vender: la puerta no la dejará pasar hasta que se marque como vendida." : null,
    },
  };
}
