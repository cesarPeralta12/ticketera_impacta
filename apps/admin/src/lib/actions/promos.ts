"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { DEFAULT_TIMEZONE, generatePromoCode, normalizePromoCode, zonedDateTimeToUtc } from "@ticketera/core";
import { DomainError, createPromoCode, setPromoActive, updatePromoCode } from "@ticketera/db";
import { formObject, intField, moneyField, zodErrors, type FormState } from "@/lib/forms";
import { ROLES, requireStaff } from "@/lib/session";

const optionalInt = (label: string, min: number, max: number) => intField(min, max, label).optional();

const baseSchema = z.object({
  description: z.string().max(200).optional(),
  maxUses: optionalInt("El máximo de usos", 1, 1_000_000),
  maxUsesPerCustomer: optionalInt("El máximo por persona", 1, 1000),
  startsAt: z.string().optional(),
  endsAt: z.string().optional(),
  promoterName: z.string().max(80).optional(),
  commissionPercent: optionalInt("La comisión", 0, 100),
  combinableWithPresale: z.literal("on").optional(),
});

const createSchema = baseSchema.extend({
  code: z.string().max(40).optional(),
  eventId: z.string().optional(),
  discountType: z.enum(["PERCENT", "FIXED"]),
  /** Porcentaje (1-100) o monto en Bs por entrada, según el tipo. */
  discountValue: z.string({ error: "Ingresa el descuento." }),
});

/** Fechas escritas en la hora de La Paz, o null si están vacías. */
function parseDates(data: { startsAt?: string; endsAt?: string }): { startsAt: Date | null; endsAt: Date | null } | { error: FormState } {
  try {
    return {
      startsAt: data.startsAt ? zonedDateTimeToUtc(data.startsAt, DEFAULT_TIMEZONE) : null,
      endsAt: data.endsAt ? zonedDateTimeToUtc(data.endsAt, DEFAULT_TIMEZONE) : null,
    };
  } catch {
    return { error: { fieldErrors: { endsAt: "Fecha inválida." } } };
  }
}

function fail(error: unknown): FormState {
  if (error instanceof DomainError) return { error: error.message };
  throw error;
}

export async function createPromoAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const staff = await requireStaff(ROLES.manage);
  const parsed = createSchema.safeParse(formObject(formData));
  if (!parsed.success) return zodErrors(parsed.error);
  const data = parsed.data;

  let discountValue: number;
  if (data.discountType === "PERCENT") {
    discountValue = Number(data.discountValue.replace(",", "."));
    if (!Number.isInteger(discountValue) || discountValue < 1 || discountValue > 100) {
      return { fieldErrors: { discountValue: "El porcentaje debe ser un número entero de 1 a 100." } };
    }
  } else {
    const money = moneyField.safeParse(data.discountValue);
    if (!money.success) return { fieldErrors: { discountValue: "Monto inválido (ej. 10 o 10,50)." } };
    discountValue = money.data;
  }
  const dates = parseDates(data);
  if ("error" in dates) return dates.error;

  // Sin código escrito se genera uno legible, con el nombre del promotor si lo hay.
  const code = data.code ? normalizePromoCode(data.code) : generatePromoCode(data.promoterName ?? "PROMO");
  try {
    const promo = await createPromoCode(
      staff.organization.id,
      {
        code,
        description: data.description,
        eventId: data.eventId || null,
        discountType: data.discountType,
        discountValue,
        combinableWithPresale: Boolean(data.combinableWithPresale),
        maxUses: data.maxUses,
        maxUsesPerCustomer: data.maxUsesPerCustomer,
        startsAt: dates.startsAt,
        endsAt: dates.endsAt,
        promoterName: data.promoterName,
        commissionPercent: data.commissionPercent,
      },
      staff.id,
    );
    revalidatePath("/promociones");
    redirect(`/promociones/${promo.id}`);
  } catch (error) {
    if (error instanceof DomainError && error.code === "DUPLICATE") return { fieldErrors: { code: error.message } };
    return fail(error);
  }
}

export async function updatePromoAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const staff = await requireStaff(ROLES.manage);
  const parsed = baseSchema.extend({ promoId: z.string() }).safeParse(formObject(formData));
  if (!parsed.success) return zodErrors(parsed.error);
  const { promoId, ...data } = parsed.data;
  const dates = parseDates(data);
  if ("error" in dates) return dates.error;
  try {
    await updatePromoCode(
      staff.organization.id,
      promoId,
      {
        description: data.description,
        maxUses: data.maxUses,
        maxUsesPerCustomer: data.maxUsesPerCustomer,
        startsAt: dates.startsAt,
        endsAt: dates.endsAt,
        promoterName: data.promoterName,
        commissionPercent: data.commissionPercent,
        combinableWithPresale: Boolean(data.combinableWithPresale),
      },
      staff.id,
    );
  } catch (error) {
    return fail(error);
  }
  revalidatePath(`/promociones/${promoId}`);
  revalidatePath("/promociones");
  return { ok: true };
}

export async function togglePromoAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const staff = await requireStaff(ROLES.manage);
  const promoId = String(formData.get("promoId") ?? "");
  try {
    await setPromoActive(staff.organization.id, promoId, formData.get("active") === "true", staff.id);
  } catch (error) {
    return fail(error);
  }
  revalidatePath(`/promociones/${promoId}`);
  revalidatePath("/promociones");
  return { ok: true };
}
