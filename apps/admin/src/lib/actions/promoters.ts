"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { DOCUMENT_ERROR, checkoutSchema } from "@ticketera/core";
import {
  DomainError,
  MIN_PASSWORD_LENGTH,
  approveSimulatedPayment,
  assignPromoter,
  createPromoterAccount,
  markTicketsEmailed,
  prisma,
  sellAsPromoter,
  settlePromoterCommission,
  unassignPromoter,
} from "@ticketera/db";
import { logAudit } from "@/lib/audit";
import { type FormState } from "@/lib/forms";
import { sendOrderTicketsEmail } from "@/lib/mail";
import { promoterPaymentProvider, simulatedPaymentsAllowed } from "@/lib/promoter-payments";
import { readSessionPick } from "@/lib/session-pick";
import { ROLES, requireAccountAdmin, requireEditor } from "@/lib/session";
import type { PosState } from "./pos";

/** "10" o "10,50" bolivianos -> centavos; null si no es un monto. */
function money(value: string) {
  return /^\d{1,6}([.,]\d{1,2})?$/.test(value) ? Math.round(Number(value.replace(",", ".")) * 100) : null;
}

/**
 * Lo que tiene el formulario de un evento del promotor: evento y funciones, vigencia, comisión (% o Bs por entrada) y
 * cupo (vacío: hasta agotar). Devuelve el error del campo si algo está mal.
 */
function readAssignment(formData: FormData) {
  const fail = (field: string, message: string) => ({ ok: false as const, error: { fieldErrors: { [field]: message } } as FormState });
  const pick = readSessionPick(formData);
  if (!pick.ok) return fail(pick.field, "message" in pick && pick.message ? pick.message : "Fecha inválida.");
  if (!pick.eventId) return fail("eventId", "Elige el evento.");
  const type = formData.get("commissionType") === "FIXED" ? "FIXED" : "PERCENT";
  const raw = String(formData.get("commissionValue") ?? "").trim();
  const value = type === "PERCENT" ? (/^\d{1,3}$/.test(raw) ? Number(raw) : null) : money(raw);
  if (value === null) return fail("commissionValue", type === "PERCENT" ? "Escribe el porcentaje (ej. 10)." : "Escribe el monto por entrada (ej. 10 o 10,50).");
  const quotaRaw = String(formData.get("quota") ?? "").trim();
  const quota = quotaRaw ? Number(quotaRaw) : null;
  if (quota !== null && (!Number.isInteger(quota) || quota < 1)) return fail("quota", "El cupo es un número de entradas (ej. 100), o vacío.");
  return {
    ok: true as const,
    value: {
      eventId: pick.eventId,
      sessionIds: pick.sessionIds,
      startsAt: pick.startsAt,
      endsAt: pick.endsAt,
      rule: { commissionType: type, commissionValue: value } as const,
      quota,
    },
  };
}

/** Asigna un evento a un promotor (o lo cambia): funciones, vigencia, comisión y cupo. */
export async function assignPromoterAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const staff = await requireEditor();
  const userId = String(formData.get("userId") ?? "");
  const read = readAssignment(formData);
  if (!read.ok) return read.error;
  try {
    const { assignment, code, scope } = await assignPromoter({ organizationId: staff.organization.id, userId, ...read.value });
    await logAudit({
      actorType: "staff",
      actorId: staff.id,
      action: "promoter.assign",
      entity: "PromoterAssignment",
      entityId: assignment.id,
      data: JSON.parse(JSON.stringify({ userId, ...read.value, code: code.code, sessions: scope.whole ? "todas" : scope.sessions })),
    });
  } catch (error) {
    if (error instanceof DomainError) return { error: error.message };
    throw error;
  }
  revalidatePath(`/promotores/${userId}`);
  revalidatePath("/promotores");
  return { ok: true, message: "Guardado." };
}

/**
 * Alta de un promotor en un solo paso: la cuenta (contraseña temporal), su teléfono, su código y su primer evento con
 * funciones, comisión y cupo. Lo hace iPass, o el organizador con administración propia.
 */
export async function createPromoterAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const staff = await requireAccountAdmin();
  const name = String(formData.get("name") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  const phone = String(formData.get("phone") ?? "").trim();
  if (name.length < 3) return { fieldErrors: { name: "Escribe el nombre." } };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { fieldErrors: { email: "Email inválido." } };
  if (password.length < MIN_PASSWORD_LENGTH) return { fieldErrors: { password: `La contraseña temporal: mínimo ${MIN_PASSWORD_LENGTH} caracteres.` } };
  if (phone && phone.replace(/\D/g, "").length < 7) return { fieldErrors: { phone: "El teléfono no parece un número (ej. 77123456)." } };
  const read = readAssignment(formData);
  if (!read.ok) return read.error;
  let userId: string;
  try {
    const created = await createPromoterAccount({
      organizationId: staff.organization.id,
      name,
      email,
      phone: phone || null,
      password,
      assignment: read.value,
    });
    userId = created.user.id;
    await logAudit({
      actorType: "staff",
      actorId: staff.id,
      action: "staff.create",
      entity: "StaffUser",
      entityId: userId,
      data: { role: "PROMOTER", organizationId: staff.organization.id, eventId: read.value.eventId, code: created.code.code },
    });
  } catch (error) {
    if (error instanceof DomainError) return { error: error.message };
    throw error;
  }
  revalidatePath("/promotores");
  revalidatePath("/usuarios");
  redirect(`/promotores/${userId}`);
}

/** Cambia el teléfono del promotor. */
export async function updatePromoterPhoneAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const staff = await requireEditor();
  const userId = String(formData.get("userId") ?? "");
  const phone = String(formData.get("phone") ?? "").trim();
  if (phone && phone.replace(/\D/g, "").length < 7) return { fieldErrors: { phone: "El teléfono no parece un número (ej. 77123456)." } };
  const { count } = await prisma.staffUser.updateMany({
    where: { id: userId, memberships: { some: { organizationId: staff.organization.id, role: "PROMOTER" } } },
    data: { phone: phone || null },
  });
  if (count === 0) return { error: "Promotor no encontrado." };
  await logAudit({ actorType: "staff", actorId: staff.id, action: "promoter.phone", entity: "StaffUser", entityId: userId });
  revalidatePath(`/promotores/${userId}`);
  return { ok: true, message: "Guardado." };
}

/** Liquida la comisión pendiente del promotor: marca sus ventas como pagadas y guarda cuánto se le pagó. */
export async function settlePromoterAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const staff = await requireEditor();
  const userId = String(formData.get("userId") ?? "");
  try {
    const payout = await settlePromoterCommission({ organizationId: staff.organization.id, promoterId: userId, staffId: staff.id, note: String(formData.get("note") ?? "") });
    revalidatePath(`/promotores/${userId}`);
    revalidatePath("/promotores");
    return { ok: true, message: `Liquidado: ${payout.orders} venta(s).` };
  } catch (error) {
    if (error instanceof DomainError) return { error: error.message };
    throw error;
  }
}

export async function unassignPromoterAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const staff = await requireEditor();
  const userId = String(formData.get("userId") ?? "");
  const eventId = String(formData.get("eventId") ?? "");
  if (!(await unassignPromoter(staff.organization.id, userId, eventId))) return { error: "Asignación no encontrada." };
  await logAudit({ actorType: "staff", actorId: staff.id, action: "promoter.unassign", entity: "StaffUser", entityId: userId, data: { eventId } });
  revalidatePath(`/promotores/${userId}`);
  revalidatePath("/promotores");
  return { ok: true };
}

/**
 * Venta de un promotor: reserva las entradas a nombre del cliente y abre el cobro por QR. No hay efectivo: las
 * entradas salen recién cuando el pago queda aprobado.
 */
export async function promoterSellAction(_prev: PosState, formData: FormData): Promise<PosState> {
  const staff = await requireEditor(ROLES.promoter);
  const sessionId = String(formData.get("sessionId") ?? "");
  const session = await prisma.eventSession.findFirst({
    where: { id: sessionId, event: { organizationId: staff.organization.id, promoters: { some: { userId: staff.id } } } },
  });
  if (!session) return { error: "Esta función no es de un evento que tengas asignado." };

  const items = [...formData.entries()].flatMap(([key, value]) => {
    if (typeof value !== "string") return [];
    if (key.startsWith("qty:") && Number(value) > 0) return [{ ticketTypeId: key.slice(4), quantity: Number(value) }];
    if (key.startsWith("seats:") && value) {
      const seatIds = value.split(",").filter(Boolean);
      return [{ ticketTypeId: key.slice(6), quantity: seatIds.length, seatIds }];
    }
    return [];
  });
  // Las entradas se mandan al correo del cliente: nombre, correo y carnet son obligatorios.
  const input = {
    sessionId,
    items,
    buyer: {
      name: String(formData.get("name") ?? "").trim(),
      email: String(formData.get("email") ?? "").trim(),
      document: String(formData.get("document") ?? ""),
    },
  };
  const parsed = checkoutSchema.safeParse(input);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    if (issue?.path[0] === "buyer" && issue.path[1] === "document") return { error: DOCUMENT_ERROR };
    if (issue?.path[0] === "buyer") return { error: "Revisa los datos del cliente: nombre de al menos 3 letras y un correo válido (ahí le llegan las entradas)." };
    return { error: issue?.message ?? "Revisa las entradas." };
  }
  const phone = String(formData.get("phone") ?? "").trim();
  if (phone && phone.replace(/\D/g, "").length < 7) return { error: "El WhatsApp del cliente no parece un número (ej. 77123456)." };

  let code: string;
  try {
    const { order } = await sellAsPromoter(parsed.data, {
      promoterId: staff.id,
      buyerPhone: phone || undefined,
      provider: promoterPaymentProvider(),
      promoCode: String(formData.get("promo") ?? "").trim() || undefined,
    });
    code = order.code;
  } catch (error) {
    if (error instanceof DomainError && error.code === "PROMO_INVALID") return { error: `Tu oferta: ${error.message}` };
    if (error instanceof DomainError) return { error: error.message, refresh: error.code === "SEAT_TAKEN" || error.code === "SOLD_OUT" };
    throw error;
  }
  await logAudit({ actorType: "staff", actorId: staff.id, action: "promoter.sale", entity: "Order", entityId: code });
  redirect(`/promotor/cobro/${code}`);
}

/**
 * Pago de prueba (sin banco conectado): aprueba el cobro como lo haría el banco, emite las entradas y se las manda al
 * correo del cliente. Solo donde se permite el cobro simulado.
 */
export async function simulatePaymentAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const staff = await requireEditor([...ROLES.promoter, ...ROLES.manage]);
  if (!simulatedPaymentsAllowed()) return { error: "El pago de prueba no está habilitado: el cobro lo confirma el banco." };
  const order = await prisma.order.findFirst({
    where: {
      code: String(formData.get("code") ?? ""),
      channel: "PROMOTER",
      ...(staff.role === "PROMOTER" ? { promoterId: staff.id } : { items: { some: { ticketType: { session: { event: { organizationId: staff.organization.id } } } } } }),
    },
  });
  if (!order) return { error: "Venta no encontrada." };
  let outcome: Awaited<ReturnType<typeof approveSimulatedPayment>>;
  try {
    outcome = await approveSimulatedPayment(order.code);
  } catch (error) {
    if (error instanceof DomainError) return { error: error.message };
    throw error;
  }
  if (outcome !== "PAID" && outcome !== "DUPLICATE") {
    return { error: "No se pudo confirmar: la reserva venció y ya no quedan esas entradas. Haz la venta de nuevo." };
  }
  if (!order.ticketsEmailedAt && (await sendOrderTicketsEmail(order.code))) await markTicketsEmailed([order.id]);
  await logAudit({ actorType: "staff", actorId: staff.id, action: "promoter.simulated_payment", entity: "Order", entityId: order.id });
  revalidatePath(`/promotor/cobro/${order.code}`);
  revalidatePath("/promotor");
  return { ok: true };
}
