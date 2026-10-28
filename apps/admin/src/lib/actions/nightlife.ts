"use server";

import { revalidatePath } from "next/cache";
import { MAX_REPEAT_WEEKS, peopleIn, tableLabel } from "@ticketera/core";
import { DomainError, getConsumption, prisma, redeemConsumption, repeatWeeklyNights } from "@ticketera/db";
import { intField, moneyField, type FormState } from "@/lib/forms";
import { staffCanSell } from "@/lib/sales-access";
import { READ_ONLY_MESSAGE, ROLES, requireEditor, requireStaff, type Staff } from "@/lib/session";

/** Noche de la organización: la Barra y "Repetir noches" solo tocan las propias (un cajero, solo las que tiene asignadas). */
async function ownNight(staff: Staff, sessionId: string) {
  const night = await prisma.eventSession.findFirst({ where: { id: sessionId, event: { organizationId: staff.organization.id } } });
  return night && (await staffCanSell(staff, night)) ? night : null;
}

export type ConsumptionView = {
  /** "Mesa VIP N° 4", o el nombre de la entrada con consumo incluido. */
  label: string;
  kind: "ENTRY" | "TABLE";
  people: number;
  buyer: string;
  orderCode: string;
  amount: number;
  spent: number;
  left: number;
  currency: string;
  tickets: { code: string; status: string; holderName: string | null }[];
  redemptions: { id: string; amount: number; at: string; staff: string; note: string | null }[];
};

export type ConsumptionResult = { ok: true; view: ConsumptionView; charged?: number } | { ok: false; error: string };

async function view(sessionId: string, raw: string): Promise<ConsumptionResult> {
  const found = await getConsumption(raw, sessionId);
  if (!found.ok) return { ok: false, error: found.reason };
  const { credit } = found;
  return {
    ok: true,
    view: {
      label: tableLabel(credit.ticketType.name, credit.tableNumber, credit.seat?.label) ?? credit.ticketType.name,
      kind: credit.ticketType.kind,
      people: peopleIn(credit.ticketType),
      buyer: credit.order.buyerName,
      orderCode: credit.order.code,
      amount: credit.amount,
      spent: credit.spent,
      left: credit.left,
      currency: credit.currency,
      tickets: credit.tickets,
      redemptions: credit.redemptions.map((r) => ({
        id: r.id,
        amount: r.amount,
        at: r.createdAt.toISOString(),
        staff: r.staff.name,
        note: r.note,
      })),
    },
  };
}

/** Barra: el saldo de la mesa o entrada del QR leído (o del código escrito). */
export async function lookupConsumptionAction(sessionId: string, raw: string): Promise<ConsumptionResult> {
  const staff = await requireStaff(ROLES.pos);
  if (!(await ownNight(staff, sessionId))) return { ok: false, error: "Noche no encontrada." };
  return view(sessionId, raw);
}

/** Barra: cobra un consumo contra el saldo y devuelve el saldo nuevo. */
export async function redeemConsumptionAction(sessionId: string, raw: string, amountText: string, note: string): Promise<ConsumptionResult> {
  const staff = await requireStaff(ROLES.pos);
  if (staff.readOnly) return { ok: false, error: READ_ONLY_MESSAGE };
  const night = await ownNight(staff, sessionId);
  if (!night) return { ok: false, error: "Noche no encontrada." };
  const amount = moneyField.safeParse(amountText.trim());
  if (!amount.success || amount.data <= 0) return { ok: false, error: "Escribe el monto a cobrar (ej. 120 o 120,50)." };
  try {
    await redeemConsumption({ raw, sessionId, amount: amount.data, staffId: staff.id, note });
  } catch (error) {
    if (error instanceof DomainError) return { ok: false, error: error.message };
    throw error;
  }
  revalidatePath(`/barra/${sessionId}`);
  const result = await view(sessionId, raw);
  return result.ok ? { ...result, charged: amount.data } : result;
}

/** "Repetir noches": copia esta noche a los días elegidos de las próximas semanas. */
export async function repeatNightsAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const staff = await requireEditor();
  const night = await ownNight(staff, String(formData.get("sessionId") ?? ""));
  if (!night) return { error: "Noche no encontrada." };
  const weekdays = [...new Set(formData.getAll("weekday").map(Number))].filter((d) => Number.isInteger(d) && d >= 0 && d <= 6);
  if (weekdays.length === 0) return { fieldErrors: { weekday: "Elige al menos un día de la semana." } };
  const weeks = intField(1, MAX_REPEAT_WEEKS, "Las semanas").safeParse(formData.get("weeks"));
  if (!weeks.success) return { fieldErrors: { weeks: weeks.error.issues[0]?.message ?? "Semanas inválidas." } };

  try {
    const { created, skipped } = await repeatWeeklyNights({ templateSessionId: night.id, weekdays, weeks: weeks.data, staffId: staff.id });
    revalidatePath(`/eventos/${night.eventId}`);
    if (created === 0) return { error: skipped > 0 ? "Esas noches ya existen." : "No hay noches para crear con esos días." };
    return {
      ok: true,
      message: `Listo: se crearon ${created} noche(s) con los mismos precios y mesas${skipped ? ` (${skipped} ya existían)` : ""}.`,
    };
  } catch (error) {
    if (error instanceof DomainError) return { error: error.message };
    throw error;
  }
}
