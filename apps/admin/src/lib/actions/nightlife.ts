"use server";

import { revalidatePath } from "next/cache";
import { MAX_REPEAT_WEEKS } from "@ticketera/core";
import { DomainError, getVoucher, prisma, redeemVoucher, repeatWeeklyNights, type Voucher } from "@ticketera/db";
import { intField, type FormState } from "@/lib/forms";
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
  currency: string;
  /** La compra se anuló: el vale no vale. */
  cancelled: boolean;
  /** Ya se leyó: cuándo (ISO), quién y la nota. */
  redeemedAt: string | null;
  redeemedBy: string | null;
  note: string | null;
};

export type ConsumptionResult =
  | { ok: true; view: ConsumptionView; /** Se acaba de marcar como leído con esta lectura. */ justRead: boolean }
  | { ok: false; error: string };

function toView(v: Voucher): ConsumptionView {
  return {
    label: v.label,
    kind: v.kind === "TABLE" ? "TABLE" : "ENTRY",
    people: v.people,
    buyer: v.buyer,
    orderCode: v.orderCode,
    amount: v.amount,
    currency: v.currency,
    cancelled: v.cancelled,
    redeemedAt: v.redeemedAt?.toISOString() ?? null,
    redeemedBy: v.redeemedBy,
    note: v.note,
  };
}

/** Barra: mira el QR de consumo leído (o el código escrito) SIN marcarlo: muestra mesa, a nombre de quién y el monto. */
export async function lookupConsumptionAction(sessionId: string, raw: string): Promise<ConsumptionResult> {
  const staff = await requireStaff(ROLES.bar);
  if (!(await ownNight(staff, sessionId))) return { ok: false, error: "Noche no encontrada." };
  const found = await getVoucher(raw, sessionId);
  return found.ok ? { ok: true, view: toView(found.voucher), justRead: false } : { ok: false, error: found.reason };
}

/** Barra: marca el QR de consumo como leído (un solo uso). Si ya estaba leído, no cambia nada y lo dice. */
export async function readVoucherAction(sessionId: string, raw: string, note: string): Promise<ConsumptionResult> {
  const staff = await requireStaff(ROLES.bar);
  if (staff.readOnly) return { ok: false, error: READ_ONLY_MESSAGE };
  if (!(await ownNight(staff, sessionId))) return { ok: false, error: "Noche no encontrada." };
  try {
    const out = await redeemVoucher({ raw, sessionId, staffId: staff.id, note });
    if (out.status === "REJECTED") return { ok: false, error: out.reason };
    if (out.status === "CANCELLED") return { ok: false, error: "Esa compra está anulada: su consumo no se puede usar." };
    revalidatePath(`/barra/${sessionId}`);
    return { ok: true, view: toView(out.voucher), justRead: out.status === "REDEEMED" };
  } catch (error) {
    if (error instanceof DomainError) return { ok: false, error: error.message };
    throw error;
  }
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
