"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { DEFAULT_TIMEZONE, generatePromoCode, normalizePromoCode, zonedDateTimeToUtc } from "@ticketera/core";
import { DomainError, createPromoCode, listPromoterAccounts, setPromoActive, updatePromoCode } from "@ticketera/db";
import { formObject, intField, moneyField, zodErrors, type FormState } from "@/lib/forms";
import { requireEditor } from "@/lib/session";

const optionalInt = (label: string, min: number, max: number) => intField(min, max, label).optional();

const baseSchema = z.object({
  description: z.string().max(200).optional(),
  maxUses: optionalInt("El máximo de usos", 1, 1_000_000),
  maxUsesPerCustomer: optionalInt("El máximo por persona", 1, 1000),
  startsAt: z.string().optional(),
  endsAt: z.string().optional(),
  /** Cuenta de promotor (vacío: sin promotor). */
  promoterId: z.string().max(40).optional(),
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
  const staff = await requireEditor();
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

  const promoterId = data.promoterId || null;
  // Sin código escrito se genera uno legible, con el nombre del promotor si lo hay.
  const promoterName = promoterId ? (await listPromoterAccounts(staff.organization.id)).find((p) => p.id === promoterId)?.name : undefined;
  const code = data.code ? normalizePromoCode(data.code) : generatePromoCode(promoterName ?? "PROMO");
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
        promoterId,
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
  const staff = await requireEditor();
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
        promoterId: data.promoterId || null,
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
  const staff = await requireEditor();
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
